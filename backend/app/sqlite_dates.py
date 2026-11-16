"""Compare SQLite datetime text without wrapping the column.

Plant dates are stored as 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'.
CAST(date AS TEXT) and date(date) stop SQLite using the date index, so a
two-day dashboard read scans the whole voltage history. A Python datetime
bind also appends '.000000', which sorts after a stored midnight stamp.
Compare the bare column to plain 'YYYY-MM-DD' strings instead.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, literal


def stored_between(column, start_day: date, end_day_exclusive: date):
    """Rows whose stored stamp falls on start_day, up to but not including end_day."""
    return and_(
        column >= literal(start_day.isoformat()),
        column < literal(end_day_exclusive.isoformat()),
    )
