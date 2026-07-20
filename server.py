from enum import Enum
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from game import Game, Player
from games_manager import GamesManager


class GameEvent(str, Enum):
    GAME_STARTED = "GAME_STARTED"
    DICE_ROLLED = "DICE_ROLLED"
    SCORE_BANKED = "SCORE_BANKED"
    ERROR = "ERROR"


class ApiResponse(BaseModel):
    protocol_version: int = 1
    message: str = ""
    game_event: GameEvent
    event_data: dict[str, Any] = Field(default_factory=dict)
    game_state: dict[str, Any] = Field(default_factory=dict)

class GameRequest(BaseModel):
    game_id: str

class PlayerRequest(BaseModel):
    name: str
    type: str


class StartRequest(BaseModel):
    players: list[PlayerRequest] = Field(min_length=1)


class BankRequest(GameRequest):
    scoring_dice: list[int]


class RollRequest(GameRequest):
    scoring_dice: list[int] = Field(default_factory=list)


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


def game_not_found_response(game_id: str) -> ApiResponse:
    return ApiResponse(
        message=f"Game not found: {game_id}",
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

@app.post("/game/start", response_model=ApiResponse)
def start_game(request: StartRequest):
    game = games_manager.create_game()

    players = [
        Player(player.name, player.type)
        for player in request.players
    ]

    event_data = game.start_game(players)

    return game_response(
        game,
        GameEvent.GAME_STARTED,
        event_data,
    )

@app.post("/game/roll", response_model=ApiResponse)
def roll(request: RollRequest):
    game = games_manager.get_game(request.game_id)
    if game is None:
        return game_not_found_response(request.game_id)

    return game_response(
        game,
        GameEvent.DICE_ROLLED,
        game.roll(request.scoring_dice),
    )

@app.post("/game/bank", response_model=ApiResponse)
def bank(request: BankRequest):
    game = games_manager.get_game(request.game_id)

    if game is None:
        return game_not_found_response(request.game_id)

    return game_response(
        game,
        GameEvent.SCORE_BANKED,
        game.bank(request.scoring_dice),
    )