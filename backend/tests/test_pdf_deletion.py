import os
import shutil
from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.main import app, DOCS_DIR, OUTPUT_DIR, jobs_db

client = TestClient(app)


def test_delete_pdf_document_success():
    # 1. Setup mock PDF and mock output directory
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_test_to_delete.pdf"
    stem = "temp_test_to_delete"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 test dummy content")

    mock_output_dir = OUTPUT_DIR / "mineru_mock" / stem
    mock_output_dir.mkdir(parents=True, exist_ok=True)
    (mock_output_dir / "content_list.json").write_text("[]", encoding="utf-8")

    assert test_pdf_path.exists()
    assert mock_output_dir.exists()

    # 2. Call DELETE /api/pdf/{filename}
    response = client.delete(f"/api/pdf/{test_filename}?delete_vectors=false")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # 3. Assert PDF and output directory are removed
    assert not test_pdf_path.exists()
    assert not mock_output_dir.exists()


def test_reset_etl_by_filename_success():
    # 1. Setup mock PDF and mock output directory
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_test_to_reset.pdf"
    stem = "temp_test_to_reset"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 test dummy content for reset")

    mock_output_dir = OUTPUT_DIR / "mineru_mock" / stem
    mock_output_dir.mkdir(parents=True, exist_ok=True)
    (mock_output_dir / "content_list.json").write_text("[]", encoding="utf-8")

    assert test_pdf_path.exists()
    assert mock_output_dir.exists()

    # 2. Call DELETE /api/etl/{filename}
    response = client.delete(f"/api/etl/{test_filename}?delete_vectors=false")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # 3. Assert PDF is PRESERVED, but output directory is removed
    assert test_pdf_path.exists()
    assert not mock_output_dir.exists()

    # Clean up test PDF
    test_pdf_path.unlink()


def test_delete_pdf_document_not_found():
    response = client.delete("/api/pdf/non_existent_file_xyz_123.pdf")
    assert response.status_code == 404


def test_delete_pdf_blocked_when_job_running():
    test_filename = "running_test_file.pdf"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 dummy")

    # Simulate active background job
    jobs_db["mock_running_job_1"] = {
        "task_id": "mock_running_job_1",
        "filename": test_filename,
        "status": "running",
    }

    try:
        response = client.delete(f"/api/pdf/{test_filename}")
        assert response.status_code == 400
        assert "진행 중인 문서는 삭제할 수 없습니다" in response.json()["detail"]
    finally:
        # Clean up
        jobs_db.pop("mock_running_job_1", None)
        if test_pdf_path.exists():
            test_pdf_path.unlink()
