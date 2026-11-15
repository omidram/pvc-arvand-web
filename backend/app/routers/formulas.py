"""Read and edit the numbers inside the plant's calculations."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import formulas
from ..auth import effective_form_level, get_current_user
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/formulas", tags=["formulas"])


class FormulaUpdate(BaseModel):
    params: dict[str, float]


def _require_edit(db: Session, user: User) -> None:
    if user.role == "admin":
        return
    if effective_form_level(db, user, "settings") != "edit":
        raise HTTPException(status_code=403, detail="Settings edit is required")


@router.get("")
def list_formulas(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return formulas.public(db)


@router.put("/{key}")
def update_formula(key: str, body: FormulaUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_edit(db, user)
    try:
        return formulas.save(db, key, body.params)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown formula") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/{key}/reset")
def reset_formula(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_edit(db, user)
    try:
        return formulas.reset(db, key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown formula") from None
