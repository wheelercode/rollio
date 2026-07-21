# ACTION REQUIRED

from enum import Enum
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

from game import Game, Player
from games_manager import GamesManager


class GameCommand(str, Enum):
    ROLL = "ROLL"
    BANK = "BANK"


class GameEvent(str, Enum):
    GAME_STARTED = "GAME_STARTED"
    DICE_ROLLED = "DICE_ROLLED"
    SCORE_BANKED = "SCORE_BANKED"
    ERROR = "ERROR"


class ApiRequest(BaseModel):
    command: GameCommand
    command_data: dict[str, Any] = Field(default_factory=dict)


class ApiResponse(BaseModel):
    protocol_version: int = 1
    message: str = ""
    game_event: GameEvent
    event_data: dict[str, Any] = Field(default_factory=dict)
    game_state: dict[str, Any] = Field(default_factory=dict)


class PlayerRequest(BaseModel):
    name: str
    type: str


class StartRequest(BaseModel):
    players: list[PlayerRequest] = Field(min_length=1)


class BankCommandData(BaseModel):
    scoring_dice: list[int]


class RollCommandData(BaseModel):
    scoring_dice: list[int] = Field(default_factory=list)


class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, set[WebSocket]] = {}

    async def connect(
        self,
        game_id: str,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()

        if game_id not in self.connections:
            self.connections[game_id] = set()

        self.connections[game_id].add(websocket)

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

    async def send_response(
        self,
        websocket: WebSocket,
        response: ApiResponse,
    ) -> None:
        await websocket.send_json(
            response.model_dump(mode="json")
        )

    async def broadcast(
        self,
        game_id: str,
        response: ApiResponse,
    ) -> None:
        game_connections = self.connections.get(game_id, set())
        disconnected: list[WebSocket] = []

        for websocket in list(game_connections):
            try:
                await self.send_response(websocket, response)
            except Exception:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(game_id, websocket)


app = FastAPI()

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


games_manager = GamesManager()
connection_manager = ConnectionManager()


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
    if game_event == GameEvent.GAME_STARTED:
        return {}

    if game_event == GameEvent.DICE_ROLLED:
        event_data = {
            "rollio": bool(result.get("rollio")),
            "selected_score": result.get(
                "held_score",
                0,
            ),
        }

        if event_data["rollio"]:
            event_data.update(
                {
                    "rolled_dice": result.get(
                        "rolled_dice",
                        [],
                    ),
                    "lost_score": result.get(
                        "lost_score",
                        0,
                    ),
                    "previous_player_id": result.get(
                        "previous_player_id",
                    ),
                }
            )

        return event_data

    if game_event == GameEvent.SCORE_BANKED:
        return {
            "previous_player_id": result.get(
                "previous_player_id",
            ),
            "banked_score": result.get(
                "banked_score",
                0,
            ),
        }

    return {}


def game_response(
    game: Game,
    game_event: GameEvent,
    result: dict[str, Any],
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
        event_data=normalize_event_data(
            game_event,
            result,
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

    return game_response(
        game,
        GameEvent.SCORE_BANKED,
        game.bank(request.scoring_dice),
    )


command_handlers = {
    GameCommand.ROLL: handle_roll_command,
    GameCommand.BANK: handle_bank_command,
}


@app.post("/game/start", response_model=ApiResponse)
def start_game(request: StartRequest):
    game = games_manager.create_game()

    players = [
        Player(player.name, player.type)
        for player in request.players
    ]

    result = game.start_game(players)

    return game_response(
        game,
        GameEvent.GAME_STARTED,
        result,
    )


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

    await connection_manager.connect(
        game_id,
        websocket,
    )

    try:
        while True:
            raw_message = await websocket.receive_json()

            try:
                api_request = ApiRequest.model_validate(
                    raw_message
                )

                handler = command_handlers[api_request.command]

                response = handler(
                    game,
                    api_request.command_data,
                )

            except ValidationError as error:
                response = invalid_request_response(
                    str(error)
                )

                await connection_manager.send_response(
                    websocket,
                    response,
                )
                continue

            await connection_manager.broadcast(
                game_id,
                response,
            )

    except WebSocketDisconnect:
        connection_manager.disconnect(
            game_id,
            websocket,
        )
