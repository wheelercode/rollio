from uuid import uuid4

from game import Game


class GamesManager:
    def __init__(self):
        self.games: dict[str, Game] = {}

    def create_game(self) -> Game:
        game_id = str(uuid4())
        game = Game(game_id)

        self.games[game_id] = game

        return game

    def get_game(self, game_id: str) -> Game | None:
        return self.games.get(game_id)

    def remove_game(self, game_id: str) -> bool:
        if game_id not in self.games:
            return False

        del self.games[game_id]
        return True