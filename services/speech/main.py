from pathlib import Path

from aihub_kit.service import create_app

app = create_app(Path(__file__).parent)
