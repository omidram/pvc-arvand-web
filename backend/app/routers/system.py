"""Live resources of the computer running the plant program."""

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..system_resources import snapshot

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/resources")
def system_resources(_user=Depends(get_current_user)):
    return snapshot()
