from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from game import Game, Player


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ManagedGame:
    game: Game
    mode: str
    last_activity: datetime
    ping_sent_at: datetime | None = None


class GamesManager:
    def __init__(self):
        self.games: dict[str, ManagedGame] = {}

    def create_game(self, mode: str) -> Game:
        game_id = str(uuid4())
        game = Game(game_id)

        self.games[game_id] = ManagedGame(
            game=game,
            mode=mode,
            last_activity=utc_now(),
        )

        return game

    def create_waiting_human_game(self, player: Player) -> Game:
        game = self.create_game("human")
        game.players = [player]
        return game

    def find_waiting_human_game(self) -> Game | None:
        for managed in self.games.values():
            game = managed.game

            if (
                managed.mode == "human"
                and not game.playing
                and len(game.players) == 1
            ):
                return game

        return None

    def join_waiting_human_game(
        self,
        player: Player,
    ) -> tuple[Game, bool]:
        game = self.find_waiting_human_game()

        if game is None:
            return self.create_waiting_human_game(player), False

        first_player = game.players[0]
        game.start_game([first_player, player])
        self.touch(game.game_id)

        return game, True

    def get_game(self, game_id: str) -> Game | None:
        managed = self.games.get(game_id)
        return managed.game if managed else None

    def get_mode(self, game_id: str) -> str | None:
        managed = self.games.get(game_id)
        return managed.mode if managed else None

    def touch(self, game_id: str) -> None:
        managed = self.games.get(game_id)

        if managed is None:
            return

        managed.last_activity = utc_now()
        managed.ping_sent_at = None

    def mark_ping_sent(self, game_id: str) -> None:
        managed = self.games.get(game_id)

        if managed is not None:
            managed.ping_sent_at = utc_now()

    def iter_managed_games(self):
        return list(self.games.items())

    def remove_game(self, game_id: str) -> bool:
        return self.games.pop(game_id, None) is not None
