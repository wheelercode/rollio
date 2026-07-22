from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import server as base_server

from computer_player import ComputerPlayer


AI_WATCH_INTERVAL_SECONDS = 0.10
AI_BEFORE_ACTION_SECONDS = 0.65
AI_AFTER_SELECTION_SECONDS = 0.55
AI_BETWEEN_ROLLS_SECONDS = 0.80

app = base_server.app

computer_player = ComputerPlayer.from_solution_file(
    Path(__file__).resolve().parent / "solution.pkl"
)

_ai_turn_tasks: dict[str, asyncio.Task] = {}


def strict_player_can_control_game(
    game,
    player_id: str,
) -> bool:
    """
    A client may control only its own currently active player.

    The original AI-mode shortcut allowed the human player's ID to
    issue commands during the computer's turn. Replacing the global
    function here closes that gap without changing server.py.
    """

    return bool(
        game.current_player is not None
        and game.current_player.player_id == player_id
        and game.current_player.type != "ai"
    )


base_server.player_can_control_game = (
    strict_player_can_control_game
)


async def broadcast_selection(
    game,
    selected_indexes: tuple[int, ...],
) -> None:
    await base_server.connection_manager.broadcast(
        game.game_id,
        base_server.game_response(
            game,
            base_server.GameEvent.DICE_SELECTION_CHANGED,
            {"success": True},
            {
                "player_id": game.current_player.player_id,
                "selected_indexes": list(selected_indexes),
            },
        ),
    )


async def broadcast_roll_started(
    game,
    player_id: str,
    selected_indexes: tuple[int, ...],
) -> None:
    await base_server.connection_manager.broadcast(
        game.game_id,
        base_server.game_response(
            game,
            base_server.GameEvent.ROLL_STARTED,
            {"success": True},
            {
                "player_id": player_id,
                "selected_indexes": list(selected_indexes),
            },
        ),
    )


async def perform_roll(
    game,
    selected_dice: tuple[int, ...],
    selected_indexes: tuple[int, ...],
) -> None:
    player_id = game.current_player.player_id

    result = game.roll(list(selected_dice))

    await broadcast_roll_started(
        game,
        player_id,
        selected_indexes,
    )

    await base_server.connection_manager.broadcast(
        game.game_id,
        base_server.game_response(
            game,
            base_server.GameEvent.DICE_ROLLED,
            result,
        ),
    )


async def perform_bank(
    game,
    selected_dice: tuple[int, ...],
) -> None:
    result = game.bank(list(selected_dice))

    if result.get("success") and result.get("game_won"):
        result["game_over"] = True
        result["winner_id"] = result.get(
            "previous_player_id"
        )

    await base_server.connection_manager.broadcast(
        game.game_id,
        base_server.game_response(
            game,
            base_server.GameEvent.SCORE_BANKED,
            result,
        ),
    )


async def broadcast_ai_error(
    game,
    error: Exception,
) -> None:
    await base_server.connection_manager.broadcast(
        game.game_id,
        base_server.ApiResponse(
            message=f"Computer player error: {error}",
            game_event=base_server.GameEvent.ERROR,
            game_state=game.getJSON(),
        ),
    )


async def play_computer_turn(
    game_id: str,
) -> None:
    """
    Play until the computer banks, gets a Rollio, or wins.

    Every action is broadcast using the same event vocabulary used
    by human commands, with short delays for client animation.
    """

    game = base_server.games_manager.get_game(game_id)

    if game is None:
        return

    try:
        await asyncio.sleep(AI_BEFORE_ACTION_SECONDS)

        while computer_player.is_computer_turn(game):
            base_server.games_manager.touch(game_id)
            decision = computer_player.decide(game)

            if decision.selected_indexes:
                await broadcast_selection(
                    game,
                    decision.selected_indexes,
                )
                await asyncio.sleep(
                    AI_AFTER_SELECTION_SECONDS
                )

            if decision.action == "BANK":
                await perform_bank(
                    game,
                    decision.selected_dice,
                )
                return

            if decision.action != "ROLL":
                raise RuntimeError(
                    "Unknown computer-player action: "
                    f"{decision.action!r}"
                )

            await perform_roll(
                game,
                decision.selected_dice,
                decision.selected_indexes,
            )

            if not computer_player.is_computer_turn(game):
                return

            await asyncio.sleep(
                AI_BETWEEN_ROLLS_SECONDS
            )

    except asyncio.CancelledError:
        raise
    except Exception as error:
        await broadcast_ai_error(game, error)


def _finish_ai_task(
    game_id: str,
    task: asyncio.Task,
) -> None:
    current = _ai_turn_tasks.get(game_id)

    if current is task:
        _ai_turn_tasks.pop(game_id, None)


async def watch_for_computer_turns() -> None:
    """
    Detect AI turns after any human WebSocket command.

    Polling keeps the existing server.py command flow unchanged and
    also catches AI turns produced by restart or future server-side
    actions.
    """

    while True:
        for game_id, managed in (
            base_server.games_manager.iter_managed_games()
        ):
            game = managed.game

            if not computer_player.is_computer_turn(game):
                continue

            existing_task = _ai_turn_tasks.get(game_id)

            if (
                existing_task is not None
                and not existing_task.done()
            ):
                continue

            task = asyncio.create_task(
                play_computer_turn(game_id)
            )
            _ai_turn_tasks[game_id] = task
            task.add_done_callback(
                lambda completed, current_game_id=game_id: (
                    _finish_ai_task(
                        current_game_id,
                        completed,
                    )
                )
            )

        await asyncio.sleep(
            AI_WATCH_INTERVAL_SECONDS
        )


_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def ai_enabled_lifespan(application):
    async with _original_lifespan(application):
        watcher_task = asyncio.create_task(
            watch_for_computer_turns()
        )

        try:
            yield
        finally:
            watcher_task.cancel()

            with suppress(asyncio.CancelledError):
                await watcher_task

            tasks = list(_ai_turn_tasks.values())

            for task in tasks:
                task.cancel()

            for task in tasks:
                with suppress(asyncio.CancelledError):
                    await task

            _ai_turn_tasks.clear()


app.router.lifespan_context = ai_enabled_lifespan
