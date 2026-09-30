"""Operation-owned SQLite connection with transaction-first close semantics."""

import sqlite3


class ClosingConnection(sqlite3.Connection):
    """Keep sqlite3's commit/rollback behavior, then release the file handle."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()
