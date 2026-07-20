from collections import Counter
from random import randint
from uuid import uuid4


class Game:
    def __init__(self, game_id=None):
        self.game_id = game_id or str(uuid4())
        self.players = []
        self.current_player = None
        self.playing = False
        self.target_score = 10_000
        self.turn = None

    def getJSON(self):
        return {
            "game_id": self.game_id,
            "playing": self.playing,
            "player_count": len(self.players),
            "players": [
                player.getJSON()
                for player in self.players
            ],
            "current_player_id": (
                self.current_player.player_id
                if self.current_player is not None
                else None
            ),
            "target_score": self.target_score,
            "turn": (
                self.turn.getJSON()
                if self.turn is not None
                else None
            ),
        }
def start_game(self, players):
    if not players:
        return {
            "success": False,
            "error": "A game requires at least one player.",
        }

    self.players = players
    self.current_player = self.players[0]
    self.playing = True
    self.turn = Turn()

    return {
        "success": True,
        "current_player_id": self.current_player.player_id,
        "player_count": len(self.players),
        "instructions": (
            f"{self.current_player.name}, you may roll at any time!"
        ),
    }

    def roll(self, n_dice):
        if not self.playing:
            return {
                "success": False,
                "error": "The game is not playing.",
            }

        if self.turn.state not in (
            "READY_TO_ROLL",
            "READY_TO_CONTINUE",
        ):
            return {
                "success": False,
                "error": "The turn is not ready for a roll.",
            }

        available_dice = 6 - len(self.turn.scored_dice)

        # Hot dice: all six dice have scored, so six are available again.
        if available_dice == 0:
            available_dice = 6

        if n_dice != available_dice:
            return {
                "success": False,
                "error": (
                    f"The turn must roll {available_dice} dice, "
                    f"not {n_dice}."
                ),
            }

        # Begin a new hot-dice set.
        if len(self.turn.scored_dice) == 6:
            self.turn.scored_dice = []

        self.turn.rolled_dice = [
            randint(1, 6)
            for _ in range(n_dice)
        ]

        self.turn.roll_number += 1
        self.turn.state = "WAITING_FOR_SELECTION"

        roll_score = self.maximum_roll_score(
            self.turn.rolled_dice
        )

        if roll_score == 0:
            rolled_dice = self.turn.rolled_dice.copy()
            lost_score = self.turn.base_score
            previous_player = self.current_player

            self._next_turn()

            return {
                "success": True,
                "rollio": True,
                "rolled_dice": rolled_dice,
                "lost_score": lost_score,
                "previous_player_id": previous_player.player_id,
                "current_player_id": self.current_player.player_id,
            }

        return {
            "success": True,
            "rollio": False,
            "rolled_dice": self.turn.rolled_dice,
            "scored_dice": self.turn.scored_dice,
            "base_score": self.turn.base_score,
            "roll_number": self.turn.roll_number,
            "state": self.turn.state,
        }

    def hold(self, scoring_dice):
        if not self.playing:
            return {
                "success": False,
                "error": "The game is not playing.",
            }

        if self.turn.state not in (
            "WAITING_FOR_SELECTION",
            "READY_TO_CONTINUE",
        ):
            return {
                "success": False,
                "error": (
                    "The turn is not waiting for a dice selection."
                ),
            }

        if not scoring_dice:
            return {
                "success": False,
                "error": "At least one die must be selected.",
            }

        rolled_counts = Counter(self.turn.rolled_dice)
        selected_counts = Counter(scoring_dice)

        for die, count in selected_counts.items():
            if count > rolled_counts[die]:
                return {
                    "success": False,
                    "error": (
                        "The selected dice are not all present "
                        "in the current roll."
                    ),
                }

        scoring_result = self.score_selection(scoring_dice)

        if scoring_result is None:
            return {
                "success": False,
                "error": (
                    "Every selected die must be part of "
                    "a scoring group."
                ),
            }

        self.turn.base_score += scoring_result["score"]
        self.turn.scored_dice.extend(sorted(scoring_dice))

        remaining_dice = list(self.turn.rolled_dice)

        for die in scoring_dice:
            remaining_dice.remove(die)

        self.turn.rolled_dice = remaining_dice
        self.turn.state = "READY_TO_CONTINUE"

        return {
            "success": True,
            "held_dice": sorted(scoring_dice),
            "score": scoring_result["score"],
            "score_groups": scoring_result["groups"],
            "scored_dice": self.turn.scored_dice,
            "base_score": self.turn.base_score,
            "roll_number": self.turn.roll_number,
            "state": self.turn.state,
        }

    def score(self, dice):
        """
        Return the score for one exact, indivisible scoring group.

        Return 0 when the supplied dice do not form a valid
        scoring group.
        """

        dice = sorted(dice)
        n_dice = len(dice)
        counts = Counter(dice)

        frequency_pattern = sorted(
            counts.values(),
            reverse=True,
        )

        # Two sets of three
        if n_dice == 6 and frequency_pattern == [3, 3]:
            return 2500

        # Four of a kind plus a pair
        if n_dice == 6 and frequency_pattern == [4, 2]:
            return 1500

        # Three pairs
        if n_dice == 6 and frequency_pattern == [2, 2, 2]:
            return 1500

        # Straight
        if dice == [1, 2, 3, 4, 5, 6]:
            return 1500

        # Three, four, five, or six of a kind
        if (
            n_dice in (3, 4, 5, 6)
            and len(counts) == 1
        ):
            die_value = dice[0]

            if die_value == 1:
                three_of_a_kind_score = 1000
            else:
                three_of_a_kind_score = die_value * 100

            multiplier = 2 ** (n_dice - 3)

            return three_of_a_kind_score * multiplier

        # Individual scoring dice
        if dice == [1]:
            return 100

        if dice == [5]:
            return 50

        return 0

    def score_selection(self, dice):
        """
        Find the maximum score that uses every supplied die.

        Return the score and authoritative scoring groups.
        Return None when the supplied dice cannot be completely
        divided into scoring groups.
        """

        dice = sorted(dice)

        if not dice:
            return None

        def search(remaining_dice):
            if not remaining_dice:
                return {
                    "score": 0,
                    "groups": [],
                }

            best_result = None
            n_remaining = len(remaining_dice)

            # Always include the first remaining die in the next
            # group. This avoids evaluating the same partition in
            # different group orders.
            for mask in range(1, 1 << n_remaining):
                if not mask & 1:
                    continue

                group = []
                leftover = []

                for index, die in enumerate(remaining_dice):
                    if mask & (1 << index):
                        group.append(die)
                    else:
                        leftover.append(die)

                group_score = self.score(group)

                if group_score == 0:
                    continue

                remaining_result = search(leftover)

                if remaining_result is None:
                    continue

                candidate = {
                    "score": (
                        group_score
                        + remaining_result["score"]
                    ),
                    "groups": [
                        {
                            "dice": group,
                            "score": group_score,
                        },
                        *remaining_result["groups"],
                    ],
                }

                if (
                    best_result is None
                    or candidate["score"] > best_result["score"]
                ):
                    best_result = candidate

            return best_result

        return search(dice)

    def maximum_roll_score(self, dice):
        """
        Return the maximum score available from any subset
        of a roll.
        """

        dice = list(dice)
        best_score = 0

        for mask in range(1, 1 << len(dice)):
            subset = [
                die
                for index, die in enumerate(dice)
                if mask & (1 << index)
            ]

            result = self.score_selection(subset)

            if result is not None:
                best_score = max(
                    best_score,
                    result["score"],
                )

        return best_score

    def _next_turn(self):
        current_index = self.players.index(
            self.current_player
        )

        next_index = (
            current_index + 1
        ) % len(self.players)

        self.current_player.turn_number += 1
        self.current_player = self.players[next_index]
        self.turn = Turn()

    def bank(self):
        if not self.playing:
            return {
                "success": False,
                "error": "The game is not playing.",
            }

        if self.turn.state != "READY_TO_CONTINUE":
            return {
                "success": False,
                "error": "The turn is not ready to bank.",
            }

        if self.turn.base_score == 0:
            return {
                "success": False,
                "error": "There is no turn score to bank.",
            }

        previous_player = self.current_player
        banked_score = self.turn.base_score

        previous_player.score += banked_score

        self._next_turn()

        return {
            "success": True,
            "banked_score": banked_score,
            "previous_player_id": previous_player.player_id,
            "current_player_id": self.current_player.player_id,
        }


class Player:
    def __init__(
        self,
        player_name,
        player_type,
        player_id=None,
    ):
        self.player_id = player_id or str(uuid4())
        self.name = player_name
        self.type = player_type
        self.turn_number = 0
        self.score = 0

    def getJSON(self):
        return {
            "player_id": self.player_id,
            "name": self.name,
            "type": self.type,
            "turn_number": self.turn_number,
            "score": self.score,
        }


class Turn:
    def __init__(self):
        self.roll_number = 0
        self.scored_dice = []
        self.rolled_dice = []
        self.base_score = 0
        self.state = "READY_TO_ROLL"

    def getJSON(self):
        return {
            "roll_number": self.roll_number,
            "scored_dice": list(self.scored_dice),
            "rolled_dice": list(self.rolled_dice),
            "base_score": self.base_score,
            "state": self.state,
        }