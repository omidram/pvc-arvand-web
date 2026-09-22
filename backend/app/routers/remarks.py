from .. import models, schemas
from ..crud import build_crud_router

router = build_crud_router(
    model=models.Remark,
    read_schema=schemas.RemarkRead,
    write_schema=schemas.RemarkBase,
    prefix="/remarks",
    tags=["remarks"],
    search_fields=["text", "author", "category"],
    default_order="date",
)

performance_tests_router = build_crud_router(
    model=models.PerformanceTest,
    read_schema=schemas.PerformanceTestRead,
    write_schema=schemas.PerformanceTestBase,
    prefix="/performance-tests",
    tags=["remarks"],
    search_fields=["plant_part"],
    default_order="date",
)
