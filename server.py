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
    DICE_HELD = "DICE_HELD"
    SCORE_BANKED = "SCORE_BANKED"
    ERROR = "ERROR"


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
    players: list[PlayerRequest]


class RollRequest(BaseModel):
    n_dice: int


class HoldRequest(BaseModel):
    scoring_dice: list[int]


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

game = Game()


def game_response(game_event: GameEvent, event_data: dict[str, Any]) -> ApiResponse:
    if event_data.get("success") is False:
        message = event_data.get("error", "The game rejected the request.")
        return ApiResponse(
            status_code=StatusCode.GAME_ERROR,
            message=message,
            game_event=GameEvent.ERROR,
            game=game.getJSON(),
            error_data=event_data,
        )

    event_data = dict(event_data)
    event_data.pop("success", None)

    return ApiResponse(
        status_code=StatusCode.OK,
        game_event=game_event,
        event_data=event_data,
        game=game.getJSON(),
    )


@app.post("/game/start", response_model=ApiResponse)
def start_game(request: StartRequest):
    players = [Player(player.name, player.type) for player in request.players]
    return game_response(GameEvent.GAME_STARTED, game.start_game(players))


@app.post("/game/roll", response_model=ApiResponse)
def roll(request: RollRequest):
    return game_response(GameEvent.DICE_ROLLED, game.roll(request.n_dice))


@app.post("/game/hold", response_model=ApiResponse)
def hold(request: HoldRequest):
    return game_response(GameEvent.DICE_HELD, game.hold(request.scoring_dice))


@app.post("/game/bank", response_model=ApiResponse)
def bank():
    return game_response(GameEvent.SCORE_BANKED, game.bank())