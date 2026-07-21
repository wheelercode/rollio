import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from enum import Enum
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

from game import Game, Player
from games_manager import GamesManager, utc_now


GAME_IDLE_BEFORE_PING = timedelta(seconds=60)
GAME_PING_TIMEOUT = timedelta(seconds=20)
GAME_CLEANUP_INTERVAL = 10


class GameCommand(str, Enum):
    ROLL = "ROLL"
    BANK = "BANK"
    SELECT_DICE = "SELECT_DICE"
    PLAY_AGAIN = "PLAY_AGAIN"


class GameEvent(str, Enum):
    GAME_WAITING = "GAME_WAITING"
    GAME_STARTED = "GAME_STARTED"
    ROLL_STARTED = "ROLL_STARTED"
    DICE_SELECTION_CHANGED = "DICE_SELECTION_CHANGED"
    DICE_ROLLED = "DICE_ROLLED"
    SCORE_BANKED = "SCORE_BANKED"
    ERROR = "ERROR"


class OpponentType(str, Enum):
    SINGLE = "single"
    HUMAN = "human"
    AI = "ai"


class ApiRequest(BaseModel):
    player_id: str
    command: GameCommand
    command_data: dict[str, Any] = Field(default_factory=dict)


class ApiResponse(BaseModel):
    protocol_version: int = 1
    message: str = ""
    game_event: GameEvent
    event_data: dict[str, Any] = Field(default_factory=dict)
    game_state: dict[str, Any] = Field(default_factory=dict)


class StartRequest(BaseModel):
    player_name: str = Field(min_length=1, max_length=24)
    opponent_type: OpponentType


class BankCommandData(BaseModel):
    scoring_dice: list[int]


class RollCommandData(BaseModel):
    scoring_dice: list[int] = Field(default_factory=list)
    selected_indexes: list[int] = Field(default_factory=list)


class SelectDiceCommandData(BaseModel):
    selected_indexes: list[int] = Field(default_factory=list)


class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, set[WebSocket]] = {}

    async def connect(
        self,
        game_id: str,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()
        self.connections.setdefault(game_id, set()).add(websocket)

    def disconnect(
        self,
        game_id: str,
        websocket: WebSocket,
    ) -> None:
        game_connections = self.connections.get(game_id)

        if game_connections is None:
            return

        game_connections.discard(websocket)

        if not game_connections:
            del self.connections[game_id]

    def has_connections(self, game_id: str) -> bool:
        return bool(self.connections.get(game_id))

    async def send_response(
        self,
        websocket: WebSocket,
        response: ApiResponse,
    ) -> None:
        await websocket.send_json(response.model_dump(mode="json"))

    async def send_transport(
        self,
        websocket: WebSocket,
        transport: str,
        transport_data: dict[str, Any] | None = None,
    ) -> None:
        await websocket.send_json(
            {
                "transport": transport,
                "transport_data": transport_data or {},
            }
        )

    async def broadcast(
        self,
        game_id: str,
        response: ApiResponse,
    ) -> None:
        disconnected: list[WebSocket] = []

        for websocket in list(
            self.connections.get(game_id, set())
        ):
            try:
                await self.send_response(websocket, response)
            except Exception:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(game_id, websocket)

    async def ping_game(self, game_id: str) -> None:
        sent_at = utc_now().isoformat()
        disconnected: list[WebSocket] = []

        for websocket in list(
            self.connections.get(game_id, set())
        ):
            try:
                await self.send_transport(
                    websocket,
                    "PING",
                    {"sent_at": sent_at},
                )
            except Exception:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(game_id, websocket)

    async def close_game(
        self,
        game_id: str,
        reason: str,
    ) -> None:
        sockets = list(self.connections.get(game_id, set()))

        for websocket in sockets:
            with suppress(Exception):
                await websocket.close(code=1000, reason=reason)

        self.connections.pop(game_id, None)


games_manager = GamesManager()
connection_manager = ConnectionManager()


async def cleanup_games() -> None:
    while True:
        await asyncio.sleep(GAME_CLEANUP_INTERVAL)
        now = utc_now()

        for game_id, managed in games_manager.iter_managed_games():
            if managed.ping_sent_at is not None:
                if now - managed.ping_sent_at >= GAME_PING_TIMEOUT:
                    await connection_manager.close_game(
                        game_id,
                        "Game expired.",
                    )
                    games_manager.remove_game(game_id)
                continue

            if now - managed.last_activity < GAME_IDLE_BEFORE_PING:
                continue

            if not connection_manager.has_connections(game_id):
                games_manager.remove_game(game_id)
                continue

            games_manager.mark_ping_sent(game_id)
            await connection_manager.ping_game(game_id)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cleanup_task = asyncio.create_task(cleanup_games())

    try:
        yield
    finally:
        cleanup_task.cancel()

        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"http://"
        r"(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)"
        r":5500"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def game_not_found_response(game_id: str) -> ApiResponse:
    return ApiResponse(
        message=f"Game not found: {game_id}",
        game_event=GameEvent.ERROR,
    )


def invalid_request_response(message: str) -> ApiResponse:
    return ApiResponse(
        message=message,
        game_event=GameEvent.ERROR,
    )


def normalize_event_data(
    game_event: GameEvent,
    result: dict[str, Any],
) -> dict[str, Any]:
    if game_event == GameEvent.DICE_ROLLED:
        event_data = {
            "rollio": bool(result.get("rollio")),
            "selected_score": result.get("held_score", 0),
        }

        if event_data["rollio"]:
            event_data.update(
                {
                    "rolled_dice": result.get("rolled_dice", []),
                    "lost_score": result.get("lost_score", 0),
                    "previous_player_id": result.get(
                        "previous_player_id"
                    ),
                }
            )

        return event_data

    if game_event == GameEvent.SCORE_BANKED:
        return {
            "previous_player_id": result.get(
                "previous_player_id"
            ),
            "banked_score": result.get("banked_score", 0),
            "game_over": bool(result.get("game_over")),
            "winner_id": result.get("winner_id"),
        }

    return {}


def game_response(
    game: Game,
    game_event: GameEvent,
    result: dict[str, Any],
    event_data: dict[str, Any] | None = None,
) -> ApiResponse:
    if result.get("success") is False:
        return ApiResponse(
            message=result.get(
                "error",
                "The game rejected the request.",
            ),
            game_event=GameEvent.ERROR,
            game_state=game.getJSON(),
        )

    return ApiResponse(
        game_event=game_event,
        event_data=(
            event_data
            if event_data is not None
            else normalize_event_data(game_event, result)
        ),
        game_state=game.getJSON(),
    )


def handle_roll_command(
    game: Game,
    command_data: dict[str, Any],
) -> ApiResponse:
    request = RollCommandData.model_validate(command_data)

    return game_response(
        game,
        GameEvent.DICE_ROLLED,
        game.roll(request.scoring_dice),
    )


def handle_bank_command(
    game: Game,
    command_data: dict[str, Any],
) -> ApiResponse:
    request = BankCommandData.model_validate(command_data)
    result = game.bank(request.scoring_dice)

    if result.get("success") and result.get("game_won"):
        result["game_over"] = True
        result["winner_id"] = result.get("previous_player_id")

    return game_response(
        game,
        GameEvent.SCORE_BANKED,
        result,
    )


def handle_play_again_command(
    game: Game,
    _command_data: dict[str, Any],
) -> ApiResponse:
    result = game.restart()

    return game_response(
        game,
        GameEvent.GAME_STARTED,
        result,
    )


def handle_select_dice_command(
    game: Game,
    player_id: str,
    command_data: dict[str, Any],
) -> ApiResponse:
    request = SelectDiceCommandData.model_validate(command_data)
    selected_indexes = request.selected_indexes

    if (
        len(selected_indexes) != len(set(selected_indexes))
        or any(index < 0 or index >= 6 for index in selected_indexes)
    ):
        return invalid_request_response(
            "Selected die indexes must be unique values from 0 through 5."
        )

    if (
        game.turn.mandatory_hot_dice
        and set(selected_indexes) != set(range(6))
    ):
        return game_response(
            game,
            GameEvent.DICE_SELECTION_CHANGED,
            {
                "success": False,
                "error": "All six hot dice must remain selected.",
            },
        )

    return game_response(
        game,
        GameEvent.DICE_SELECTION_CHANGED,
        {"success": True},
        {
            "player_id": player_id,
            "selected_indexes": selected_indexes,
        },
    )


command_handlers = {
    GameCommand.ROLL: handle_roll_command,
    GameCommand.BANK: handle_bank_command,
}


def player_can_control_game(
    game: Game,
    player_id: str,
) -> bool:
    mode = games_manager.get_mode(game.game_id)

    if mode == "ai":
        return True

    return (
        game.current_player is not None
        and game.current_player.player_id == player_id
    )


@app.post("/game/start", response_model=ApiResponse)
async def start_game(request: StartRequest):
    player = Player(
        request.player_name.strip() or "Player",
        "human",
    )

    if request.opponent_type == OpponentType.SINGLE:
        game = games_manager.create_game("single")
        result = game.start_game([player])

        return game_response(
            game,
            GameEvent.GAME_STARTED,
            result,
            {"player_id": player.player_id},
        )

    if request.opponent_type == OpponentType.AI:
        game = games_manager.create_game("ai")
        result = game.start_game(
            [
                player,
                Player("Computer", "ai"),
            ]
        )

        return game_response(
            game,
            GameEvent.GAME_STARTED,
            result,
            {"player_id": player.player_id},
        )

    game, matched = games_manager.join_waiting_human_game(
        player
    )

    if not matched:
        return game_response(
            game,
            GameEvent.GAME_WAITING,
            {"success": True},
            {
                "player_id": player.player_id,
                "waiting_for_other_player": True,
            },
        )

    response = game_response(
        game,
        GameEvent.GAME_STARTED,
        {"success": True},
        {"player_id": player.player_id},
    )

    # The first player is already connected and waiting.
    # Do not send the second player's private local player ID.
    await connection_manager.broadcast(
        game.game_id,
        game_response(
            game,
            GameEvent.GAME_STARTED,
            {"success": True},
            {},
        ),
    )

    return response


@app.websocket("/ws/game/{game_id}")
async def game_websocket(
    websocket: WebSocket,
    game_id: str,
):
    game = games_manager.get_game(game_id)

    if game is None:
        await websocket.accept()
        await connection_manager.send_response(
            websocket,
            game_not_found_response(game_id),
        )
        await websocket.close(
            code=1008,
            reason="Game not found.",
        )
        return

    await connection_manager.connect(game_id, websocket)
    games_manager.touch(game_id)

    try:
        while True:
            raw_message = await websocket.receive_json()

            if raw_message.get("transport") == "PONG":
                games_manager.touch(game_id)
                continue

            try:
                api_request = ApiRequest.model_validate(
                    raw_message
                )

                actor_exists = any(
                    player.player_id == api_request.player_id
                    for player in game.players
                )

                if not actor_exists:
                    response = invalid_request_response(
                        "Player does not belong to this game."
                    )
                elif api_request.command == GameCommand.PLAY_AGAIN:
                    games_manager.touch(game_id)
                    response = handle_play_again_command(
                        game,
                        api_request.command_data,
                    )
                elif not game.playing:
                    response = invalid_request_response(
                        "The game is waiting for another player."
                    )
                elif not player_can_control_game(
                    game,
                    api_request.player_id,
                ):
                    response = invalid_request_response(
                        "It is not your turn."
                    )
                else:
                    games_manager.touch(game_id)

                    if api_request.command == GameCommand.SELECT_DICE:
                        response = handle_select_dice_command(
                            game,
                            api_request.player_id,
                            api_request.command_data,
                        )
                    else:
                        handler = command_handlers[
                            api_request.command
                        ]
                        response = handler(
                            game,
                            api_request.command_data,
                        )

            except ValidationError as error:
                response = invalid_request_response(str(error))
                await connection_manager.send_response(
                    websocket,
                    response,
                )
                continue

            if (
                api_request.command == GameCommand.ROLL
                and response.game_event == GameEvent.DICE_ROLLED
            ):
                roll_request = RollCommandData.model_validate(
                    api_request.command_data
                )

                await connection_manager.broadcast(
                    game_id,
                    game_response(
                        game,
                        GameEvent.ROLL_STARTED,
                        {"success": True},
                        {
                            "player_id": api_request.player_id,
                            "selected_indexes": (
                                roll_request.selected_indexes
                            ),
                        },
                    ),
                )

            await connection_manager.broadcast(
                game_id,
                response,
            )

    except WebSocketDisconnect:
        connection_manager.disconnect(
            game_id,
            websocket,
        )
