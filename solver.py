from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from functools import cache
from itertools import combinations, combinations_with_replacement
from math import factorial, inf
from time import perf_counter
from typing import Iterable
import pickle
from pathlib import Path

from game import Game


TARGET_SCORE = 10_000
SCORE_STEP = 50
TARGET_UNITS = TARGET_SCORE // SCORE_STEP
OPENING_BANK_UNITS = 1_000 // SCORE_STEP

DICE_COUNT = 6
DIE_FACES = tuple(range(1, DICE_COUNT + 1))

SOLVER_TOLERANCE = 1e-10
MAX_LAYER_ITERATIONS = 10_000
MAX_DOOMED_ITERATIONS = 10_000

SOLVER_FORMAT_VERSION = 2
SOLVER_OBJECTIVE = "minimize_roll_and_bank_actions_selection_cost_zero"

SOLVER_DATA_DIRECTORY = Path(__file__).resolve().parent / "solver_data"
SOLVER_LAYER_DIRECTORY = SOLVER_DATA_DIRECTORY / "layers"

FINAL_SOLUTION_PATH = SOLVER_DATA_DIRECTORY / "solution.pkl"

RULES = Game()


@dataclass(frozen=True)
class Selection:
    """One legal scoring selection."""

    dice: tuple[int, ...]
    score_units: int
    next_dice: int
    exact_finish_allowed: bool

    @property
    def score(self) -> int:
        return self.score_units * SCORE_STEP


@dataclass(frozen=True)
class RollPattern:
    """
    One unordered dice result.

    A pattern is either:

    - a Rollio;
    - mandatory six-dice hot dice;
    - a normal scoring roll with one or more selections.
    """

    dice: tuple[int, ...]
    probability: float
    rollio: bool
    mandatory_hot_dice: bool
    selections: tuple[Selection, ...]


@dataclass
class SolvedGame:
    """
    Compact solution tables.

    values_by_remaining[r][turn][dice] is the expected number
    of player actions remaining when:

    - r score units remain to reach 10,000;
    - turn score is `turn` units;
    - `dice` dice are available to roll.

    Turn scores greater than the remaining target are collapsed
    to the single doomed value `r + 1`.
    """

    values_by_remaining: list[list[list[float]] | None]
    start_values: list[float]

    def roll_value(
        self,
        total_score: int,
        turn_score: int,
        dice_available: int,
    ) -> float:
        remaining_units = score_to_units(
            TARGET_SCORE - total_score
        )

        turn_units = normalize_turn_units(
            remaining_units,
            score_to_units(turn_score),
        )

        table = self.values_by_remaining[
            remaining_units
        ]

        if table is None:
            raise ValueError(
                "No active table exists for the terminal state."
            )

        return table[turn_units][dice_available]


def score_to_units(score: int) -> int:
    """Convert a score to 50-point solver units."""

    if score < 0 or score % SCORE_STEP != 0:
        raise ValueError(
            "Scores must be nonnegative multiples of 50."
        )

    return score // SCORE_STEP


def units_to_score(units: int) -> int:
    """Convert solver units back to a Rollio score."""

    return units * SCORE_STEP


def canonical_dice(
    dice: Iterable[int],
) -> tuple[int, ...]:
    """Return a sorted, hashable dice multiset."""

    result = tuple(sorted(dice))

    if not result:
        raise ValueError("Dice cannot be empty.")

    if len(result) > DICE_COUNT:
        raise ValueError(
            "A roll cannot contain more than six dice."
        )

    if any(die not in DIE_FACES for die in result):
        raise ValueError(
            "Dice values must be integers from 1 through 6."
        )

    return result


def normalize_turn_units(
    remaining_units: int,
    turn_units: int,
) -> int:
    """
    Collapse every over-target turn to one doomed value.

    If 20 units remain, every turn score above 20 becomes 21.
    """

    if not 1 <= remaining_units <= TARGET_UNITS:
        raise ValueError(
            "remaining_units must be from 1 through 200."
        )

    if turn_units < 0:
        raise ValueError(
            "turn_units cannot be negative."
        )

    return min(
        turn_units,
        remaining_units + 1,
    )


def remove_selected_dice(
    rolled_dice: tuple[int, ...],
    selected_dice: tuple[int, ...],
) -> tuple[int, ...]:
    """Return the dice left after a selection."""

    remaining = list(rolled_dice)

    for die in selected_dice:
        remaining.remove(die)

    return tuple(remaining)


@cache
def maximum_roll_score(
    dice: tuple[int, ...],
) -> int:
    """Cached wrapper around the authoritative game rule."""

    if not dice:
        return 0

    return RULES.maximum_roll_score(list(dice))


@cache
def complete_selection_score(
    dice: tuple[int, ...],
) -> int | None:
    """
    Return the maximum score that consumes every supplied die.
    """

    result = RULES.score_selection(list(dice))

    if result is None:
        return None

    return result["score"]


@cache
def legal_selections(
    rolled_dice: tuple[int, ...],
) -> tuple[Selection, ...]:
    """
    Return every strategically distinct legal selection.

    Selections that produce the same score, next dice count,
    and exact-finish eligibility are equivalent for the solver.
    """

    rolled_dice = canonical_dice(rolled_dice)

    selections: dict[
        tuple[int, int, bool],
        Selection,
    ] = {}

    for size in range(1, len(rolled_dice) + 1):
        for indexes in combinations(
            range(len(rolled_dice)),
            size,
        ):
            selected = tuple(
                rolled_dice[index]
                for index in indexes
            )

            score = complete_selection_score(selected)

            if score is None:
                continue

            remaining_dice = remove_selected_dice(
                rolled_dice,
                selected,
            )

            if remaining_dice:
                next_dice = len(remaining_dice)
            else:
                next_dice = DICE_COUNT

            # To win exactly, the engine requires every remaining
            # scoring die from the current roll to be used.
            exact_finish_allowed = (
                maximum_roll_score(remaining_dice) == 0
            )

            score_units = score_to_units(score)

            key = (
                score_units,
                next_dice,
                exact_finish_allowed,
            )

            existing = selections.get(key)

            if (
                existing is None
                or selected < existing.dice
            ):
                selections[key] = Selection(
                    dice=selected,
                    score_units=score_units,
                    next_dice=next_dice,
                    exact_finish_allowed=(
                        exact_finish_allowed
                    ),
                )

    return tuple(
        sorted(
            selections.values(),
            key=lambda selection: (
                selection.score_units,
                selection.next_dice,
                selection.dice,
            ),
        )
    )


def ordered_roll_count(
    dice: tuple[int, ...],
) -> int:
    """
    Count the ordered rolls represented by an unordered roll.
    """

    result = factorial(len(dice))

    for count in Counter(dice).values():
        result //= factorial(count)

    return result


@cache
def roll_patterns(
    dice_count: int,
) -> tuple[RollPattern, ...]:
    """
    Generate all unordered outcomes for a dice count.
    """

    if not 1 <= dice_count <= DICE_COUNT:
        raise ValueError(
            "dice_count must be from 1 through 6."
        )

    denominator = DICE_COUNT ** dice_count
    patterns: list[RollPattern] = []

    for dice in combinations_with_replacement(
        DIE_FACES,
        dice_count,
    ):
        probability = (
            ordered_roll_count(dice)
            / denominator
        )

        if maximum_roll_score(dice) == 0:
            patterns.append(
                RollPattern(
                    dice=dice,
                    probability=probability,
                    rollio=True,
                    mandatory_hot_dice=False,
                    selections=(),
                )
            )
            continue

        complete_score = complete_selection_score(
            dice
        )

        mandatory_hot_dice = (
            dice_count == DICE_COUNT
            and complete_score is not None
        )

        if mandatory_hot_dice:
            forced_selection = Selection(
                dice=dice,
                score_units=score_to_units(
                    complete_score
                ),
                next_dice=DICE_COUNT,
                exact_finish_allowed=False,
            )

            selections = (forced_selection,)
        else:
            selections = legal_selections(dice)

        if not selections:
            raise RuntimeError(
                f"Scoring roll has no selections: {dice}"
            )

        patterns.append(
            RollPattern(
                dice=dice,
                probability=probability,
                rollio=False,
                mandatory_hot_dice=(
                    mandatory_hot_dice
                ),
                selections=selections,
            )
        )

    probability_total = sum(
        pattern.probability
        for pattern in patterns
    )

    if abs(probability_total - 1.0) > 1e-12:
        raise RuntimeError(
            "Roll probabilities do not sum to one."
        )

    return tuple(patterns)


def bank_action_value(
    *,
    remaining_units: int,
    turn_units: int,
    opened: bool,
    exact_finish_allowed: bool,
    start_values: list[float],
) -> float:
    """
    Return the value of Bank, or infinity if unavailable.

    The returned value includes the Bank action itself.
    """

    if turn_units <= 0:
        return inf

    if turn_units > remaining_units:
        return inf

    if (
        not opened
        and turn_units < OPENING_BANK_UNITS
    ):
        return inf

    if turn_units == remaining_units:
        if not exact_finish_allowed:
            return inf

        # The Bank action ends the game.
        return 1.0

    next_remaining = (
        remaining_units - turn_units
    )

    # One Bank action plus the value of the next turn.
    return 1.0 + start_values[next_remaining]


def selection_choice_value(
    *,
    selection: Selection,
    remaining_units: int,
    current_turn_units: int,
    opened: bool,
    table: list[list[float]],
    start_values: list[float],
) -> float:
    """
    Return the value after applying one normal selection.

    This does not include the selection action itself.
    """

    next_turn_units = normalize_turn_units(
        remaining_units,
        current_turn_units
        + selection.score_units,
    )

    roll_value = table[
        next_turn_units
    ][selection.next_dice]

    bank_value = bank_action_value(
        remaining_units=remaining_units,
        turn_units=next_turn_units,
        opened=opened,
        exact_finish_allowed=(
            selection.exact_finish_allowed
        ),
        start_values=start_values,
    )

    return min(
        roll_value,
        bank_value,
    )


def scoring_pattern_value(
    *,
    pattern: RollPattern,
    remaining_units: int,
    current_turn_units: int,
    opened: bool,
    table: list[list[float]],
    start_values: list[float],
) -> float:
    """
    Return the value after a scoring roll has appeared.

    The Roll action has already been counted by the caller.
    """

    if pattern.mandatory_hot_dice:
        selection = pattern.selections[0]

        next_turn_units = normalize_turn_units(
            remaining_units,
            current_turn_units
            + selection.score_units,
        )

        # Mandatory hot dice are selected automatically.
        # Bank is unavailable; Roll is forced.
        return table[next_turn_units][DICE_COUNT]

    best_choice = inf

    for selection in pattern.selections:
        choice_value = selection_choice_value(
            selection=selection,
            remaining_units=remaining_units,
            current_turn_units=current_turn_units,
            opened=opened,
            table=table,
            start_values=start_values,
        )

        if choice_value < best_choice:
            best_choice = choice_value

    # A normal dice selection costs one player action.
    return best_choice


def evaluate_roll_state(
    *,
    remaining_units: int,
    turn_units: int,
    dice_available: int,
    opened: bool,
    table: list[list[float]],
    start_values: list[float],
    reset_value: float,
) -> float:
    """
    Apply one Bellman update to a ready-to-roll state.

    The returned value includes the Roll action.
    """

    expected_successor_value = 0.0

    for pattern in roll_patterns(dice_available):
        if pattern.rollio:
            successor_value = reset_value
        else:
            successor_value = scoring_pattern_value(
                pattern=pattern,
                remaining_units=remaining_units,
                current_turn_units=turn_units,
                opened=opened,
                table=table,
                start_values=start_values,
            )

        expected_successor_value += (
            pattern.probability
            * successor_value
        )

    return 1.0 + expected_successor_value


def solve_doomed_row(
    *,
    remaining_units: int,
    opened: bool,
    table: list[list[float]],
    start_values: list[float],
    reset_value: float,
    tolerance: float,
) -> None:
    """
    Solve the six roll states for an already-doomed turn.

    Any additional score stays in the same canonical doomed
    turn-score row, while a Rollio resets to turn score zero.
    """

    doomed_turn = remaining_units + 1
    row = table[doomed_turn]

    for _ in range(MAX_DOOMED_ITERATIONS):
        largest_change = 0.0

        for dice_available in range(
            1,
            DICE_COUNT + 1,
        ):
            previous = row[dice_available]

            updated = evaluate_roll_state(
                remaining_units=remaining_units,
                turn_units=doomed_turn,
                dice_available=dice_available,
                opened=opened,
                table=table,
                start_values=start_values,
                reset_value=reset_value,
            )

            row[dice_available] = updated

            largest_change = max(
                largest_change,
                abs(updated - previous),
            )

        if largest_change < tolerance:
            return

    raise RuntimeError(
        "The doomed-turn row did not converge."
    )


def recompute_layer(
    *,
    remaining_units: int,
    opened: bool,
    table: list[list[float]],
    start_values: list[float],
    reset_value: float,
    tolerance: float,
) -> float:
    """
    Recompute one score layer for a proposed reset-state value.

    Turn scores are processed downward because scoring can only
    increase the current turn score.
    """

    solve_doomed_row(
        remaining_units=remaining_units,
        opened=opened,
        table=table,
        start_values=start_values,
        reset_value=reset_value,
        tolerance=tolerance,
    )

    for turn_units in range(
        remaining_units,
        -1,
        -1,
    ):
        for dice_available in range(
            1,
            DICE_COUNT + 1,
        ):
            table[turn_units][dice_available] = (
                evaluate_roll_state(
                    remaining_units=remaining_units,
                    turn_units=turn_units,
                    dice_available=dice_available,
                    opened=opened,
                    table=table,
                    start_values=start_values,
                    reset_value=reset_value,
                )
            )

    return table[0][DICE_COUNT]


def solve_score_layer(
    *,
    remaining_units: int,
    start_values: list[float],
    tolerance: float = SOLVER_TOLERANCE,
) -> list[list[float]]:
    """
    Solve every roll state for one banked-score layer.

    `remaining_units` is solved only after every smaller remaining
    score has already been solved.
    """

    opened = remaining_units < TARGET_UNITS

    # Valid turn rows:
    # 0 through remaining, plus remaining + 1 for doomed turns.
    table = [
        [0.0] * (DICE_COUNT + 1)
        for _ in range(remaining_units + 2)
    ]

    reset_value = 0.0

    for _ in range(MAX_LAYER_ITERATIONS):
        new_reset_value = recompute_layer(
            remaining_units=remaining_units,
            opened=opened,
            table=table,
            start_values=start_values,
            reset_value=reset_value,
            tolerance=tolerance,
        )

        if (
            abs(new_reset_value - reset_value)
            < tolerance
        ):
            reset_value = new_reset_value

            # One final pass aligns every table entry with the
            # converged reset value.
            recompute_layer(
                remaining_units=remaining_units,
                opened=opened,
                table=table,
                start_values=start_values,
                reset_value=reset_value,
                tolerance=tolerance,
            )

            return table

        reset_value = new_reset_value

    raise RuntimeError(
        "Score layer did not converge: "
        f"remaining={units_to_score(remaining_units):,}"
    )


def layer_path(remaining_units: int) -> Path:
    """Return the persistence path for one score layer."""

    return (
        SOLVER_LAYER_DIRECTORY
        / f"remaining_{remaining_units:03d}.pkl"
    )


def atomic_pickle_write(
    path: Path,
    value: object,
) -> None:
    """
    Write a pickle atomically.

    The completed temporary file replaces the destination only
    after serialization succeeds.
    """

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    with temporary_path.open("wb") as file:
        pickle.dump(
            value,
            file,
            protocol=pickle.HIGHEST_PROTOCOL,
        )

        file.flush()

    temporary_path.replace(path)


def read_pickle(path: Path) -> object:
    """Read one pickle file."""

    with path.open("rb") as file:
        return pickle.load(file)


def metadata_matches(
    saved_metadata: object,
) -> bool:
    """Return whether saved data belongs to this solver."""

    return saved_metadata == solver_metadata()


def save_score_layer(
    *,
    remaining_units: int,
    table: list[list[float]],
    start_value: float,
) -> None:
    """Persist one completed score layer."""

    payload = {
        "metadata": solver_metadata(),
        "remaining_units": remaining_units,
        "start_value": start_value,
        "table": table,
    }

    atomic_pickle_write(
        layer_path(remaining_units),
        payload,
    )


def load_score_layer(
    remaining_units: int,
) -> tuple[list[list[float]], float] | None:
    """
    Load one completed layer.

    Invalid, incompatible, or damaged files are ignored.
    """

    path = layer_path(remaining_units)

    if not path.exists():
        return None

    try:
        payload = read_pickle(path)
    except (
        OSError,
        EOFError,
        pickle.UnpicklingError,
        AttributeError,
        ValueError,
    ):
        print(
            f"Ignoring unreadable checkpoint: {path.name}"
        )
        return None

    if not isinstance(payload, dict):
        print(
            f"Ignoring invalid checkpoint: {path.name}"
        )
        return None

    if not metadata_matches(
        payload.get("metadata")
    ):
        print(
            f"Ignoring incompatible checkpoint: {path.name}"
        )
        return None

    if (
        payload.get("remaining_units")
        != remaining_units
    ):
        print(
            f"Ignoring mismatched checkpoint: {path.name}"
        )
        return None

    table = payload.get("table")
    start_value = payload.get("start_value")

    if not isinstance(table, list):
        print(
            f"Ignoring invalid checkpoint table: {path.name}"
        )
        return None

    if not isinstance(start_value, (int, float)):
        print(
            f"Ignoring invalid checkpoint value: {path.name}"
        )
        return None

    return table, float(start_value)


def save_final_solution(
    solved: SolvedGame,
) -> None:
    """Persist the complete solved game."""

    payload = {
        "metadata": solver_metadata(),
        "values_by_remaining": (
            solved.values_by_remaining
        ),
        "start_values": solved.start_values,
    }

    atomic_pickle_write(
        FINAL_SOLUTION_PATH,
        payload,
    )


def load_final_solution() -> SolvedGame | None:
    """
    Load the complete solution when it is compatible.

    Invalid or obsolete files are ignored.
    """

    if not FINAL_SOLUTION_PATH.exists():
        return None

    try:
        payload = read_pickle(
            FINAL_SOLUTION_PATH
        )
    except (
        OSError,
        EOFError,
        pickle.UnpicklingError,
        AttributeError,
        ValueError,
    ):
        print(
            "Ignoring unreadable final solution."
        )
        return None

    if not isinstance(payload, dict):
        print(
            "Ignoring invalid final solution."
        )
        return None

    if not metadata_matches(
        payload.get("metadata")
    ):
        print(
            "Ignoring incompatible final solution."
        )
        return None

    values_by_remaining = payload.get(
        "values_by_remaining"
    )
    start_values = payload.get(
        "start_values"
    )

    if not isinstance(values_by_remaining, list):
        return None

    if not isinstance(start_values, list):
        return None

    if len(values_by_remaining) != TARGET_UNITS + 1:
        return None

    if len(start_values) != TARGET_UNITS + 1:
        return None

    return SolvedGame(
        values_by_remaining=values_by_remaining,
        start_values=start_values,
    )


def load_checkpointed_solution() -> tuple[
    list[list[list[float]] | None],
    list[float],
    int,
]:
    """
    Load the longest contiguous sequence of solved layers.

    Layers must exist in order because each layer depends on all
    smaller remaining-score layers.
    """

    values_by_remaining: list[
        list[list[float]] | None
    ] = [None] * (TARGET_UNITS + 1)

    start_values = [0.0] * (TARGET_UNITS + 1)

    completed_layers = 0

    for remaining_units in range(
        1,
        TARGET_UNITS + 1,
    ):
        loaded = load_score_layer(
            remaining_units
        )

        if loaded is None:
            break

        table, start_value = loaded

        values_by_remaining[
            remaining_units
        ] = table

        start_values[
            remaining_units
        ] = start_value

        completed_layers = remaining_units

    return (
        values_by_remaining,
        start_values,
        completed_layers,
    )

def solver_metadata() -> dict[str, object]:
    """
    Return the identity of the mathematical problem being solved.

    Saved data is accepted only when every field matches.
    """

    return {
        "format_version": SOLVER_FORMAT_VERSION,
        "objective": SOLVER_OBJECTIVE,
        "target_score": TARGET_SCORE,
        "score_step": SCORE_STEP,
        "opening_bank_score": 1_000,
        "dice_count": DICE_COUNT,
        "mandatory_six_dice_hot_dice": True,
        "exact_target_required": True,
        "selection_action_cost": 0,
        "roll_action_cost": 1,
        "bank_action_cost": 1,
    }


def layer_path(remaining_units: int) -> Path:
    """Return the persistence path for one score layer."""

    return (
        SOLVER_LAYER_DIRECTORY
        / f"remaining_{remaining_units:03d}.pkl"
    )


def atomic_pickle_write(
    path: Path,
    value: object,
) -> None:
    """
    Write a pickle atomically.

    The completed temporary file replaces the destination only
    after serialization succeeds.
    """

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    with temporary_path.open("wb") as file:
        pickle.dump(
            value,
            file,
            protocol=pickle.HIGHEST_PROTOCOL,
        )

        file.flush()

    temporary_path.replace(path)


def read_pickle(path: Path) -> object:
    """Read one pickle file."""

    with path.open("rb") as file:
        return pickle.load(file)


def metadata_matches(
    saved_metadata: object,
) -> bool:
    """Return whether saved data belongs to this solver."""

    return saved_metadata == solver_metadata()


def save_score_layer(
    *,
    remaining_units: int,
    table: list[list[float]],
    start_value: float,
) -> None:
    """Persist one completed score layer."""

    payload = {
        "metadata": solver_metadata(),
        "remaining_units": remaining_units,
        "start_value": start_value,
        "table": table,
    }

    atomic_pickle_write(
        layer_path(remaining_units),
        payload,
    )


def load_score_layer(
    remaining_units: int,
) -> tuple[list[list[float]], float] | None:
    """
    Load one completed layer.

    Invalid, incompatible, or damaged files are ignored.
    """

    path = layer_path(remaining_units)

    if not path.exists():
        return None

    try:
        payload = read_pickle(path)
    except (
        OSError,
        EOFError,
        pickle.UnpicklingError,
        AttributeError,
        ValueError,
    ):
        print(
            f"Ignoring unreadable checkpoint: {path.name}"
        )
        return None

    if not isinstance(payload, dict):
        print(
            f"Ignoring invalid checkpoint: {path.name}"
        )
        return None

    if not metadata_matches(
        payload.get("metadata")
    ):
        print(
            f"Ignoring incompatible checkpoint: {path.name}"
        )
        return None

    if (
        payload.get("remaining_units")
        != remaining_units
    ):
        print(
            f"Ignoring mismatched checkpoint: {path.name}"
        )
        return None

    table = payload.get("table")
    start_value = payload.get("start_value")

    if not isinstance(table, list):
        print(
            f"Ignoring invalid checkpoint table: {path.name}"
        )
        return None

    if not isinstance(start_value, (int, float)):
        print(
            f"Ignoring invalid checkpoint value: {path.name}"
        )
        return None

    return table, float(start_value)


def save_final_solution(
    solved: SolvedGame,
) -> None:
    """Persist the complete solved game."""

    payload = {
        "metadata": solver_metadata(),
        "values_by_remaining": (
            solved.values_by_remaining
        ),
        "start_values": solved.start_values,
    }

    atomic_pickle_write(
        FINAL_SOLUTION_PATH,
        payload,
    )


def load_final_solution() -> SolvedGame | None:
    """
    Load the complete solution when it is compatible.

    Invalid or obsolete files are ignored.
    """

    if not FINAL_SOLUTION_PATH.exists():
        return None

    try:
        payload = read_pickle(
            FINAL_SOLUTION_PATH
        )
    except (
        OSError,
        EOFError,
        pickle.UnpicklingError,
        AttributeError,
        ValueError,
    ):
        print(
            "Ignoring unreadable final solution."
        )
        return None

    if not isinstance(payload, dict):
        print(
            "Ignoring invalid final solution."
        )
        return None

    if not metadata_matches(
        payload.get("metadata")
    ):
        print(
            "Ignoring incompatible final solution."
        )
        return None

    values_by_remaining = payload.get(
        "values_by_remaining"
    )
    start_values = payload.get(
        "start_values"
    )

    if not isinstance(values_by_remaining, list):
        return None

    if not isinstance(start_values, list):
        return None

    if len(values_by_remaining) != TARGET_UNITS + 1:
        return None

    if len(start_values) != TARGET_UNITS + 1:
        return None

    return SolvedGame(
        values_by_remaining=values_by_remaining,
        start_values=start_values,
    )


def load_checkpointed_solution() -> tuple[
    list[list[list[float]] | None],
    list[float],
    int,
]:
    """
    Load the longest contiguous sequence of solved layers.

    Layers must exist in order because each layer depends on all
    smaller remaining-score layers.
    """

    values_by_remaining: list[
        list[list[float]] | None
    ] = [None] * (TARGET_UNITS + 1)

    start_values = [0.0] * (TARGET_UNITS + 1)

    completed_layers = 0

    for remaining_units in range(
        1,
        TARGET_UNITS + 1,
    ):
        loaded = load_score_layer(
            remaining_units
        )

        if loaded is None:
            break

        table, start_value = loaded

        values_by_remaining[
            remaining_units
        ] = table

        start_values[
            remaining_units
        ] = start_value

        completed_layers = remaining_units

    return (
        values_by_remaining,
        start_values,
        completed_layers,
    )

def solve_game(
    *,
    tolerance: float = SOLVER_TOLERANCE,
    progress_interval: int = 10,
    use_persistence: bool = True,
) -> SolvedGame:
    """
    Load, resume, or solve the complete Rollio value table.

    Only Roll and Bank count as player actions. Dice selection
    remains an optimized zero-cost decision.
    """

    if use_persistence:
        completed_solution = (
            load_final_solution()
        )

        if completed_solution is not None:
            print(
                "Loaded complete solver solution from disk."
            )

            return completed_solution

        (
            values_by_remaining,
            start_values,
            completed_layers,
        ) = load_checkpointed_solution()
    else:
        values_by_remaining = [
            None
        ] * (TARGET_UNITS + 1)

        start_values = [
            0.0
        ] * (TARGET_UNITS + 1)

        completed_layers = 0

    if completed_layers:
        last_banked_score = (
            TARGET_SCORE
            - units_to_score(completed_layers)
        )

        print(
            f"Loaded {completed_layers:,} "
            f"checkpointed layers."
        )

        print(
            f"Resuming after banked score "
            f"{last_banked_score:,}."
        )

    started_at = perf_counter()

    first_unsolved_layer = completed_layers + 1

    for remaining_units in range(
        first_unsolved_layer,
        TARGET_UNITS + 1,
    ):
        table = solve_score_layer(
            remaining_units=remaining_units,
            start_values=start_values,
            tolerance=tolerance,
        )

        start_value = table[0][DICE_COUNT]

        values_by_remaining[
            remaining_units
        ] = table

        start_values[
            remaining_units
        ] = start_value

        if use_persistence:
            save_score_layer(
                remaining_units=remaining_units,
                table=table,
                start_value=start_value,
            )

        if (
            remaining_units % progress_interval == 0
            or remaining_units == 1
            or remaining_units == TARGET_UNITS
        ):
            elapsed = perf_counter() - started_at

            total_score = (
                TARGET_SCORE
                - units_to_score(remaining_units)
            )

            print(
                f"Solved banked score "
                f"{total_score:>5,}; "
                f"expected Roll/Bank actions "
                f"from turn start "
                f"{start_value:,.6f}; "
                f"elapsed {elapsed:,.1f}s"
            )

    solved = SolvedGame(
        values_by_remaining=values_by_remaining,
        start_values=start_values,
    )

    if use_persistence:
        save_final_solution(solved)

        print(
            f"Saved complete solution to "
            f"{FINAL_SOLUTION_PATH}"
        )

    return solved


def best_selection(
    solved: SolvedGame,
    *,
    total_score: int,
    turn_score: int,
    rolled_dice: Iterable[int],
) -> Selection:
    """
    Return the optimal scoring selection for a concrete roll.
    """

    dice = canonical_dice(rolled_dice)
    remaining_units = score_to_units(
        TARGET_SCORE - total_score
    )
    current_turn_units = normalize_turn_units(
        remaining_units,
        score_to_units(turn_score),
    )

    table = solved.values_by_remaining[
        remaining_units
    ]

    if table is None:
        raise ValueError(
            "The game is already terminal."
        )

    patterns = {
        pattern.dice: pattern
        for pattern in roll_patterns(len(dice))
    }

    pattern = patterns[dice]

    if pattern.rollio:
        raise ValueError(
            "A Rollio has no scoring selection."
        )

    if pattern.mandatory_hot_dice:
        return pattern.selections[0]

    opened = total_score > 0
    best: Selection | None = None
    best_value = inf

    for selection in pattern.selections:
        value = selection_choice_value(
            selection=selection,
            remaining_units=remaining_units,
            current_turn_units=current_turn_units,
            opened=opened,
            table=table,
            start_values=solved.start_values,
        )

        if value < best_value:
            best_value = value
            best = selection

    if best is None:
        raise RuntimeError(
            "No legal selection was found."
        )

    return best


def best_roll_or_bank(
    solved: SolvedGame,
    *,
    total_score: int,
    turn_score: int,
    dice_available: int,
    exact_finish_allowed: bool = True,
    mandatory_hot_dice: bool = False,
) -> str:
    """
    Return "ROLL" or "BANK" for a post-selection state.

    `exact_finish_allowed` matters only when banking would land
    exactly on 10,000.
    """

    remaining_units = score_to_units(
        TARGET_SCORE - total_score
    )
    turn_units = normalize_turn_units(
        remaining_units,
        score_to_units(turn_score),
    )

    table = solved.values_by_remaining[
        remaining_units
    ]

    if table is None:
        raise ValueError(
            "The game is already terminal."
        )

    if mandatory_hot_dice:
        return "ROLL"

    roll_value = table[
        turn_units
    ][dice_available]

    bank_value = bank_action_value(
        remaining_units=remaining_units,
        turn_units=turn_units,
        opened=total_score > 0,
        exact_finish_allowed=exact_finish_allowed,
        start_values=solved.start_values,
    )

    if bank_value < roll_value:
        return "BANK"

    return "ROLL"


def print_roll_pattern_counts() -> None:
    """Print compact roll-pattern statistics."""

    total_patterns = 0

    for dice_count in range(1, DICE_COUNT + 1):
        patterns = roll_patterns(dice_count)
        total_patterns += len(patterns)

        rollios = sum(
            pattern.rollio
            for pattern in patterns
        )

        mandatory = sum(
            pattern.mandatory_hot_dice
            for pattern in patterns
        )

        print(
            f"{dice_count} dice: "
            f"{len(patterns):,} patterns, "
            f"{rollios:,} Rollios, "
            f"{mandatory:,} mandatory hot-dice patterns"
        )

    print(
        f"Total unordered roll patterns: "
        f"{total_patterns:,}"
    )


if __name__ == "__main__":
    print_roll_pattern_counts()
    print()

    print(
        "Objective: minimize Roll and Bank actions."
    )
    print(
        "Dice selection is optimized at zero action cost."
    )
    print()

    solution = solve_game(
        progress_interval=10,
        use_persistence=True,
    )

    print()

    print(
        "Expected Roll/Bank actions from a new game: "
        f"{solution.start_values[TARGET_UNITS]:,.6f}"
    )