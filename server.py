from enum import Enum
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from game import Game, Player


class StatusCode(str, Enum):
    OK = "OK"
    GAME_ERROR = "GAME_ERROR"


class GameEvent(str, Enum):
    GAME_STARTED = "GAME_STARTED"
    DICE_ROLLED = "DICE_ROLLED"
    SCORE_BANKED = "SCORE_BANKED"
    ERROR = "ERROR"

class GameRequest(BaseModel):
    game_id: str

class ApiResponse(BaseModel):
    protocol_version: int = 1
    status_code: StatusCode
    message: str = ""
    game_event: GameEvent
    event_data: dict[str, Any] = Field(default_factory=dict)
    game: dict[str, Any] = Field(default_factory=dict)
    error_data: dict[str, Any] = Field(default_factory=dict)


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


games: dict[str, Game] = {}


def get_game(game_id: str) -> Game | None:
    return games.get(game_id)


def game_not_found_response(game_id: str) -> ApiResponse:
    message = f"Game not found: {game_id}"

    return ApiResponse(
        status_code=StatusCode.GAME_ERROR,
        message=message,
        game_event=GameEvent.ERROR,
        error_data={
            "game_id": game_id,
            "error": message,
        },
    )


def game_response(
    game: Game,
    game_event: GameEvent,
    event_data: dict[str, Any],
) -> ApiResponse:
    if event_data.get("success") is False:
        message = event_data.get(
            "error",
            "The game rejected the request.",
        )

        return ApiResponse(
            status_code=StatusCode.GAME_ERROR,
            message=message,
            game_event=GameEvent.ERROR,
            game=game.getJSON(),
            error_data=event_data,
        )

    normalized_event_data = dict(event_data)
    normalized_event_data.pop("success", None)

    return ApiResponse(
        status_code=StatusCode.OK,
        game_event=game_event,
        event_data=normalized_event_data,
        game=game.getJSON(),
    )

@app.post("/game/start", response_model=ApiResponse)
def start_game(request: StartRequest):
    game = Game()

    players = [
        Player(player.name, player.type)
        for player in request.players
    ]

    event_data = game.start_game(players)

    games[game.game_id] = game

    return game_response(
        game,
        GameEvent.GAME_STARTED,
        event_data,
    )

@app.post("/game/roll", response_model=ApiResponse)
def roll(request: RollRequest):
    game = get_game(request.game_id)

    if game is None:
        return game_not_found_response(request.game_id)

    return game_response(
        game,
        GameEvent.DICE_ROLLED,
        game.roll(request.scoring_dice),
    )

@app.post("/game/bank", response_model=ApiResponse)
def bank(request: BankRequest):
    game = get_game(request.game_id)

    if game is None:
        return game_not_found_response(request.game_id)

    return game_response(
        game,
        GameEvent.SCORE_BANKED,
        game.bank(request.scoring_dice),
    )