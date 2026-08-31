import os
import sys
import time
import json
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class MineruService:
    def __init__(self, venv_bin: Optional[Path] = None):
        if venv_bin is None:
            self.venv_bin = Path(sys.executable).parent
        else:
            self.venv_bin = venv_bin
        self.mineru_cmd = str(self.venv_bin / "mineru")

    def parse_pdf(
        self,
        pdf_path: Path,
        output_dir: Path,
        start_page: Optional[int] = None,
        end_page: Optional[int] = None,
        lang: str = "korean",
        backend: str = "pipeline",
        method: str = "auto",
    ) -> Dict[str, Any]:
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_name = pdf_path.stem

        cmd = [
            self.mineru_cmd,
            "-p", str(pdf_path),
            "-o", str(output_dir),
            "-b", backend,
            "-m", method,
            "-l", lang,
        ]

        if start_page is not None:
            cmd.extend(["-s", str(start_page)])
        if end_page is not None:
            cmd.extend(["-e", str(end_page)])

        logger.info(f"Executing MinerU command: {' '.join(cmd)}")
        start_time = time.time()

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False
        )

        elapsed_time = round(time.time() - start_time, 2)
        logger.info(f"MinerU execution finished in {elapsed_time}s with exit code {proc.returncode}")

        if proc.returncode != 0:
            logger.error(f"MinerU error output:\n{proc.stdout}")
            return {
                "success": False,
                "error": proc.stdout[-1500:] if proc.stdout else "Unknown error",
                "elapsed_time": elapsed_time,
            }

        # Find output results
        # MinerU usually outputs to: output_dir / pdf_name / <backend> / ...
        doc_dir = output_dir / pdf_name
        md_content = ""
        content_list = []
        md_file_path = None
        layout_pdf_path = None
        images_list = []

        if doc_dir.exists():
            for root, _, files in os.walk(doc_dir):
                root_p = Path(root)
                for f in files:
                    if f.endswith(".md"):
                        md_file_path = root_p / f
                    elif f.endswith("_content_list_v2.json"):
                        try:
                            with open(root_p / f, "r", encoding="utf-8") as jf:
                                content_list_v2 = json.load(jf)
                        except Exception:
                            pass
                    elif f.endswith("_content_list.json"):
                        try:
                            with open(root_p / f, "r", encoding="utf-8") as jf:
                                content_list_v1 = json.load(jf)
                        except Exception:
                            pass
                    elif f.endswith("_layout.pdf"):
                        layout_pdf_path = root_p / f

            # Prefer v2 if available, otherwise v1
            content_list = content_list_v2 if 'content_list_v2' in locals() and content_list_v2 else (content_list_v1 if 'content_list_v1' in locals() else [])

            # Check images
            images_dir = None
            for p in doc_dir.glob("**/images"):
                if p.is_dir():
                    images_dir = p
                    break
            if images_dir and images_dir.exists():
                images_list = [img.name for img in images_dir.iterdir() if img.suffix.lower() in [".png", ".jpg", ".jpeg"]]

        if md_file_path and md_file_path.exists():
            with open(md_file_path, "r", encoding="utf-8") as f:
                md_content = f.read()

        return {
            "success": True,
            "elapsed_time": elapsed_time,
            "markdown": md_content,
            "markdown_path": str(md_file_path) if md_file_path else None,
            "layout_pdf_path": str(layout_pdf_path) if layout_pdf_path else None,
            "content_list": content_list,
            "images": images_list,
            "output_dir": str(doc_dir),
        }
