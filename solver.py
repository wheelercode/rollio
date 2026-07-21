from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Iterable

from game import Game


TARGET_SCORE = 10_000
DICE_COUNT = 6


# We temporarily reuse Game's pure scoring functions.
# Later, these can move into a shared rollio_rules.py module.
RULES = Game()


@dataclass(frozen=True)
class Selection:
    """
    One legal scoring choice from the current roll.
    """

    dice: tuple[int, ...]
    score: int

    @property
    def dice_used(self) -> int:
        return len(self.dice)


@dataclass(frozen=True)
class SelectionState:
    """
    The player has rolled dice and must choose scoring dice.
    """

    total_score: int
    turn_score: int
    rolled_dice: tuple[int, ...]

    @property
    def dice_rolled_count(self) -> int:
        return len(self.rolled_dice)


@dataclass(frozen=True)
class ChoiceState:
    """
    The scoring selection has already been applied.

    The player must now choose Roll or Bank, unless the rules
    force another roll.
    """

    total_score: int
    turn_score: int
    dice_available: int
    mandatory_hot_dice: bool = False

    @property
    def provisional_total(self) -> int:
        return self.total_score + self.turn_score

    @property
    def exact_target(self) -> bool:
        return self.provisional_total == TARGET_SCORE

    @property
    def over_target(self) -> bool:
        return self.provisional_total > TARGET_SCORE


def canonical_dice(dice: Iterable[int]) -> tuple[int, ...]:
    """
    Dice order has no strategic significance.
    """

    return tuple(sorted(dice))


def legal_scoring_selections(
    rolled_dice: Iterable[int],
) -> tuple[Selection, ...]:
    """
    Return every distinct legal scoring subset of a roll.

    A subset is legal only when every selected die can be
    completely divided into valid scoring groups.
    """

    rolled = canonical_dice(rolled_dice)
    selections: dict[tuple[int, ...], Selection] = {}

    for size in range(1, len(rolled) + 1):
        for indexes in combinations(range(len(rolled)), size):
            selected = tuple(rolled[index] for index in indexes)

            # Duplicate values can cause combinations of indexes
            # to produce the same dice multiset.
            if selected in selections:
                continue

            scoring_result = RULES.score_selection(list(selected))

            if scoring_result is None:
                continue

            selections[selected] = Selection(
                dice=selected,
                score=scoring_result["score"],
            )

    return tuple(
        sorted(
            selections.values(),
            key=lambda selection: (
                selection.score,
                selection.dice_used,
                selection.dice,
            ),
        )
    )


def entire_roll_scores(
    rolled_dice: Iterable[int],
) -> bool:
    """
    Return True when every die in the roll can be used in scoring.
    """

    rolled = canonical_dice(rolled_dice)

    return RULES.score_selection(list(rolled)) is not None


def is_mandatory_hot_dice(
    rolled_dice: Iterable[int],
) -> bool:
    """
    Six dice were rolled and all six are scoring.
    """

    rolled = canonical_dice(rolled_dice)

    return (
        len(rolled) == DICE_COUNT
        and entire_roll_scores(rolled)
    )


def apply_selection(
    state: SelectionState,
    selection: Selection,
) -> ChoiceState:
    """
    Apply one legal scoring selection without mutating live game state.
    """

    legal = {
        candidate.dice: candidate
        for candidate in legal_scoring_selections(
            state.rolled_dice
        )
    }

    if selection.dice not in legal:
        raise ValueError(
            f"Illegal scoring selection: {selection.dice}"
        )

    mandatory_hot = is_mandatory_hot_dice(
        state.rolled_dice
    )

    if mandatory_hot:
        complete_roll = canonical_dice(
            state.rolled_dice
        )

        if selection.dice != complete_roll:
            raise ValueError(
                "All six dice must be selected during "
                "mandatory hot dice."
            )

    new_turn_score = (
        state.turn_score
        + selection.score
    )

    unselected_count = (
        len(state.rolled_dice)
        - selection.dice_used
    )

    # If every available die was scored, all six become
    # available again.
    dice_available = (
        DICE_COUNT
        if unselected_count == 0
        else unselected_count
    )

    return ChoiceState(
        total_score=state.total_score,
        turn_score=new_turn_score,
        dice_available=dice_available,
        mandatory_hot_dice=mandatory_hot,
    )


def can_bank(state: ChoiceState) -> bool:
    """
    Return whether banking is legal under the current rules.

    This is useful for action enumeration, not for defining victory.
    """

    if state.mandatory_hot_dice:
        return False

    # First successful bank must be at least 1,000.
    if (
        state.total_score == 0
        and state.turn_score < 1_000
    ):
        return False

    return state.turn_score > 0


def bank_transition(
    state: ChoiceState,
) -> ChoiceState | None:
    """
    Apply Bank.

    Return None when the exact target is reached, representing
    the terminal state.
    """

    if not can_bank(state):
        raise ValueError("Bank is not legal in this state.")

    new_total = (
        state.total_score
        + state.turn_score
    )

    if new_total == TARGET_SCORE:
        return None

    return ChoiceState(
        total_score=new_total,
        turn_score=0,
        dice_available=DICE_COUNT,
        mandatory_hot_dice=False,
    )


def rollio_transition(
    state: ChoiceState,
) -> ChoiceState:
    """
    A Rollio loses the current turn score and begins a new turn.
    """

    return ChoiceState(
        total_score=state.total_score,
        turn_score=0,
        dice_available=DICE_COUNT,
        mandatory_hot_dice=False,
    )