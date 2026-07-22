from __future__ import annotations

import asyncio
import random
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import server as base_server

from computer_player import ComputerPlayer


AI_WATCH_INTERVAL_SECONDS = 0.10

# Human-like pacing ranges.
AI_TURN_START_DELAY = (0.55, 0.90)
AI_THINKING_DELAY = (0.45, 0.85)
AI_FIRST_SELECTION_DELAY = (0.20, 0.35)
AI_BETWEEN_SELECTIONS_DELAY = (0.35, 0.55)
AI_AFTER_SELECTION_DELAY = (0.50, 0.75)
AI_BETWEEN_ROLLS_DELAY = (0.55, 0.90)

app = base_server.app

computer_player = ComputerPlayer.from_solution_file(
    Path(__file__).resolve().parent / "solution.pkl"
)

_ai_turn_tasks: dict[str, asyncio.Task] = {}


async def random_delay(
    delay_range: tuple[float, float],
) -> None:
    await asyncio.sleep(
        random.uniform(*delay_range)
    )


def strict_player_can_control_game(
    game,
    player_id: str,
) -> bool:
    """
    A client may control only its own active human player.
    """

    return bool(
        game.current_player is not None
        and game.current_player.player_id == player_id
        and game.current_player.type != "ai"
    )


base_server.player_can_control_game = (
    strict_player_can_control_game
)


def tray_indexes_for_selection(
    held_indexes: set[int],
    rolled_indexes: tuple[int, ...],
) -> tuple[int, ...]:
    """
    Convert indexes relative to the latest rolled-dice array into
    absolute indexes in the browser's permanent six-slot tray.
    """

    open_indexes = [
        index
        for index in range(6)
        if index not in held_indexes
    ]

    if any(
        index < 0 or index >= len(open_indexes)
        for index in rolled_indexes
    ):
        raise RuntimeError(
            "Computer selection index does not fit the "
            "currently open tray slots."
        )

    return tuple(
        open_indexes[index]
        for index in rolled_indexes
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


async def broadcast_selection_organically(
    game,
    selected_indexes: tuple[int, ...],
) -> None:
    """
    Select dice one at a time.

    DICE_SELECTION_CHANGED carries the complete current selection,
    so each event sends a progressively larger list.
    """

    if not selected_indexes:
        return

    await random_delay(
        AI_FIRST_SELECTION_DELAY
    )

    current_selection: list[int] = []

    for index in selected_indexes:
        current_selection.append(index)

        await broadcast_selection(
            game,
            tuple(current_selection),
        )

        if len(current_selection) < len(selected_indexes):
            await random_delay(
                AI_BETWEEN_SELECTIONS_DELAY
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

    The computer pauses before each decision, selects dice one at
    a time, then pauses before rolling or banking.
    """

    game = base_server.games_manager.get_game(game_id)

    if game is None:
        return

    held_indexes: set[int] = set()

    try:
        await random_delay(
            AI_TURN_START_DELAY
        )

        while computer_player.is_computer_turn(game):
            base_server.games_manager.touch(game_id)

            await random_delay(
                AI_THINKING_DELAY
            )

            decision = computer_player.decide(game)

            tray_selected_indexes = (
                tray_indexes_for_selection(
                    held_indexes,
                    decision.selected_indexes,
                )
            )

            await broadcast_selection_organically(
                game,
                tray_selected_indexes,
            )

            if tray_selected_indexes:
                await random_delay(
                    AI_AFTER_SELECTION_DELAY
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
                tray_selected_indexes,
            )

            if not computer_player.is_computer_turn(game):
                return

            held_indexes.update(
                tray_selected_indexes
            )

            # Hot dice reset the browser tray to six open slots.
            if len(held_indexes) == 6:
                held_indexes.clear()

            await random_delay(
                AI_BETWEEN_ROLLS_DELAY
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

            tasks = list(
                _ai_turn_tasks.values()
            )

            for task in tasks:
                task.cancel()

            for task in tasks:
                with suppress(
                    asyncio.CancelledError
                ):
                    await task

            _ai_turn_tasks.clear()


app.router.lifespan_context = ai_enabled_lifespan
