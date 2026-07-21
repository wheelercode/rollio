import unittest
from unittest.mock import patch

from game import Game, Player
from server import GameEvent, handle_select_dice_command


class MandatoryHotDiceTests(unittest.TestCase):
    def setUp(self):
        self.game = Game("test-game")
        self.player = Player("Player 1", "human", "player-1")
        self.game.start_game([self.player])

    def roll_values(self, values, scoring_dice=None):
        with patch("game.randint", side_effect=values):
            return self.game.roll(scoring_dice)

    def set_mandatory_roll(self, dice):
        self.game.turn.state = "WAITING_FOR_SELECTION"
        self.game.turn.rolled_dice = list(dice)
        self.game.turn.mandatory_hot_dice = True

    def test_six_die_straight_is_mandatory(self):
        result = self.roll_values([1, 2, 3, 4, 5, 6])

        self.assertTrue(result["success"])
        self.assertTrue(self.game.turn.mandatory_hot_dice)
        self.assertEqual(
            self.game.score_selection(self.game.turn.rolled_dice)["score"],
            1500,
        )

    def test_partitionable_six_die_rolls_are_mandatory(self):
        rolls = (
            [1, 1, 1, 2, 2, 2],
            [1, 1, 5, 5, 5, 5],
            [1, 1, 2, 2, 3, 3],
            [5, 5, 5, 5, 5, 5],
        )

        for dice in rolls:
            with self.subTest(dice=dice):
                game = Game("partition-test")
                game.start_game([Player("Player", "human")])

                with patch("game.randint", side_effect=dice):
                    result = game.roll()

                self.assertTrue(result["success"])
                self.assertTrue(game.turn.mandatory_hot_dice)

    def test_bank_is_rejected_without_mutating_mandatory_roll(self):
        dice = [1, 2, 3, 4, 5, 6]
        self.set_mandatory_roll(dice)

        result = self.game.bank(dice)

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "You must roll the hot dice.")
        self.assertEqual(self.game.turn.rolled_dice, dice)
        self.assertEqual(self.game.turn.base_score, 0)

    def test_mandatory_roll_rejects_a_subset(self):
        dice = [1, 2, 3, 4, 5, 6]
        self.set_mandatory_roll(dice)

        result = self.game.roll([1, 5])

        self.assertFalse(result["success"])
        self.assertIn("all six hot dice", result["error"])
        self.assertEqual(self.game.turn.rolled_dice, dice)
        self.assertEqual(self.game.turn.base_score, 0)

    def test_mandatory_roll_accepts_all_dice_and_rolls_six_again(self):
        forced_dice = [1, 2, 3, 4, 5, 6]
        next_dice = [1, 2, 2, 3, 4, 6]
        self.set_mandatory_roll(forced_dice)

        result = self.roll_values(next_dice, forced_dice)

        self.assertTrue(result["success"])
        self.assertFalse(result["rollio"])
        self.assertEqual(result["held_score"], 1500)
        self.assertEqual(self.game.turn.base_score, 1500)
        self.assertEqual(self.game.turn.rolled_dice, next_dice)
        self.assertFalse(self.game.turn.mandatory_hot_dice)

    def test_five_scoring_dice_remain_optional_and_can_be_banked(self):
        self.game.turn.state = "WAITING_FOR_SELECTION"
        self.game.turn.rolled_dice = [1]

        result = self.roll_values([1, 1, 1, 5, 5], [1])

        self.assertTrue(result["success"])
        self.assertFalse(self.game.turn.mandatory_hot_dice)
        self.assertIsNotNone(
            self.game.score_selection(self.game.turn.rolled_dice)
        )

        bank_result = self.game.bank([1, 1, 1, 5, 5])

        self.assertTrue(bank_result["success"])
        self.assertEqual(bank_result["banked_score"], 1200)

    def test_exact_target_on_mandatory_roll_does_not_win(self):
        self.player.score = 8500
        self.roll_values([1, 2, 3, 4, 5, 6])

        result = self.game.bank([1, 2, 3, 4, 5, 6])

        self.assertFalse(result["success"])
        self.assertTrue(self.game.playing)
        self.assertEqual(self.player.score, 8500)
        self.assertEqual(self.game.turn.base_score, 0)

    def test_legal_exact_target_bank_still_wins(self):
        self.player.score = 9900
        self.game.turn.state = "WAITING_FOR_SELECTION"
        self.game.turn.rolled_dice = [1, 2]

        result = self.game.bank([1])

        self.assertTrue(result["success"])
        self.assertTrue(result["game_won"])
        self.assertFalse(self.game.playing)
        self.assertEqual(self.player.score, 10_000)

    def test_turn_json_exposes_mandatory_hot_dice(self):
        self.roll_values([1, 2, 3, 4, 5, 6])

        turn_state = self.game.getJSON()["turn"]

        self.assertIs(turn_state["mandatory_hot_dice"], True)

    def test_api_rejects_changing_the_forced_selection(self):
        self.set_mandatory_roll([1, 2, 3, 4, 5, 6])

        response = handle_select_dice_command(
            self.game,
            self.player.player_id,
            {"selected_indexes": [0, 4]},
        )

        self.assertEqual(response.game_event, GameEvent.ERROR)
        self.assertTrue(
            response.game_state["turn"]["mandatory_hot_dice"]
        )
        self.assertEqual(
            response.message,
            "All six hot dice must remain selected.",
        )


if __name__ == "__main__":
    unittest.main()
