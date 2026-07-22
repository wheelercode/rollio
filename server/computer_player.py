from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from game import Game
from solver import (
    DICE_COUNT,
    TARGET_SCORE,
    Selection,
    SolvedGame,
    best_roll_or_bank,
    best_selection,
    load_final_solution,
)


@dataclass(frozen=True)
class ComputerDecision:
    """
    One complete computer-player decision.

    `selected_dice` is sent to Game.roll() or Game.bank().
    `selected_indexes` is broadcast so the browser can animate
    the same dice selection a human player would make.
    """

    action: str
    selected_dice: tuple[int, ...] = ()
    selected_indexes: tuple[int, ...] = ()


class ComputerPlayer:
    """
    Converts the solved optimal policy into game commands.

    This class does not own networking, timing, or WebSockets.
    It only examines a Game and returns the next action.
    """

    def __init__(self, solved: SolvedGame):
        self.solved = solved

    @classmethod
    def from_solution_file(
        cls,
        solution_path: Path | None = None,
    ) -> "ComputerPlayer":
        """
        Load the solved policy.

        solver.load_final_solution() uses server/solution.pkl.
        The optional path is accepted for explicit validation and
        future deployment flexibility.
        """

        if solution_path is not None and not solution_path.exists():
            raise FileNotFoundError(
                f"Computer-player policy not found: {solution_path}"
            )

        solved = load_final_solution()

        if solved is None:
            expected_path = (
                solution_path
                if solution_path is not None
                else Path(__file__).resolve().parent / "solution.pkl"
            )

            raise RuntimeError(
                "Could not load a compatible computer-player policy "
                f"from {expected_path}. Rebuild solution.pkl with the "
                "current solver format and rules."
            )

        return cls(solved)

    @staticmethod
    def is_computer_turn(game: Game) -> bool:
        return bool(
            game.playing
            and game.current_player is not None
            and game.current_player.type == "ai"
        )

    @staticmethod
    def _selection_indexes(
        rolled_dice: list[int],
        selected_dice: tuple[int, ...],
    ) -> tuple[int, ...]:
        """
        Map selected die values back to concrete tray indexes.

        Duplicate values are matched from left to right.
        """

        unused_indexes = list(range(len(rolled_dice)))
        selected_indexes: list[int] = []

        for selected_die in selected_dice:
            matching_index = next(
                (
                    index
                    for index in unused_indexes
                    if rolled_dice[index] == selected_die
                ),
                None,
            )

            if matching_index is None:
                raise RuntimeError(
                    "The solver selected dice that are not present "
                    "in the current roll."
                )

            selected_indexes.append(matching_index)
            unused_indexes.remove(matching_index)

        return tuple(sorted(selected_indexes))

    def _validate_game(self, game: Game) -> None:
        if game.target_score != TARGET_SCORE:
            raise RuntimeError(
                "The computer-player policy target does not match "
                f"the game target: policy={TARGET_SCORE:,}, "
                f"game={game.target_score:,}."
            )

        if not self.is_computer_turn(game):
            raise RuntimeError(
                "ComputerPlayer was asked to act when it is not "
                "the computer's turn."
            )

        if game.turn is None:
            raise RuntimeError(
                "The active game has no turn state."
            )

    def decide(self, game: Game) -> ComputerDecision:
        """
        Return the computer's next Roll or Bank decision.

        READY_TO_ROLL always means an empty-selection Roll.
        WAITING_FOR_SELECTION uses the solved policy to choose both
        the dice and whether to Roll or Bank afterward.
        """

        self._validate_game(game)

        if game.turn.state == "READY_TO_ROLL":
            return ComputerDecision(action="ROLL")

        if game.turn.state != "WAITING_FOR_SELECTION":
            raise RuntimeError(
                "The computer cannot act from turn state "
                f"{game.turn.state!r}."
            )

        rolled_dice = list(game.turn.rolled_dice)

        if not rolled_dice:
            raise RuntimeError(
                "The computer is waiting for a selection but no "
                "rolled dice are present."
            )

        selection = best_selection(
            self.solved,
            total_score=game.current_player.score,
            turn_score=game.turn.base_score,
            rolled_dice=rolled_dice,
        )

        selected_indexes = self._selection_indexes(
            rolled_dice,
            selection.dice,
        )

        next_turn_score = (
            game.turn.base_score
            + selection.score
        )

        action = best_roll_or_bank(
            self.solved,
            total_score=game.current_player.score,
            turn_score=next_turn_score,
            dice_available=selection.next_dice,
            exact_finish_allowed=(
                selection.exact_finish_allowed
            ),
            mandatory_hot_dice=(
                game.turn.mandatory_hot_dice
            ),
        )

        return ComputerDecision(
            action=action,
            selected_dice=selection.dice,
            selected_indexes=selected_indexes,
        )
