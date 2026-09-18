"""Run the real FastAPI app with generated fixtures, isolated from user datasets."""

import atexit
import json
import os
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

frontend = Path(__file__).resolve().parents[1]
backend = frontend.parent / "backend"
sys.path.insert(0, str(backend))

# All file fixtures live in a disposable directory. An optional PostgreSQL URL
# must point at a disposable database dedicated to this test run.
with tempfile.TemporaryDirectory(prefix="curator-frontend-e2e-") as temporary:
    root = Path(temporary)
    os.environ["JWT_SECRET"] = "frontend-test-only-secret-at-least-32-characters"
    os.environ["DATABASE_URL"] = os.environ.get(
        "E2E_DATABASE_URL", f"sqlite:///{root / 'test.db'}"
    )
    if os.environ.get("E2E_DATABASE_URL"):
        from sqlalchemy import create_engine, text
        from sqlalchemy.engine import make_url

        bootstrap = create_engine(os.environ["E2E_DATABASE_URL"])
        schema = "frontend_e2e_" + uuid4().hex
        with bootstrap.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        def cleanup_schema():
            with bootstrap.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            bootstrap.dispose()

        atexit.register(cleanup_schema)
        url = make_url(os.environ["E2E_DATABASE_URL"]).update_query_dict(
            {"options": f"-csearch_path={schema}"}
        )
        os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
    os.environ["DATA_DIR"] = str(root / "datasets")
    os.environ["IMPORT_DIR"] = str(root / "import")
    os.environ["CORS_ORIGINS"] = '["http://127.0.0.1:15173"]'

    import nibabel as nib
    import numpy as np
    import uvicorn
    from fastapi.testclient import TestClient
    from PIL import Image, ImageDraw
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

    from app.core.security import password_hasher
    from app.db import Base, SessionLocal, engine
    from app.main import app
    from app.models import Role, User

    Base.metadata.create_all(engine)
    with SessionLocal.begin() as db:
        for name, role in [
            ("e2e-admin", Role.ADMIN),
            ("e2e-doctor", Role.REVIEWER),
            ("e2e-other", Role.REVIEWER),
        ]:
            db.add(
                User(
                    username=name,
                    full_name=name.replace("e2e-", "Test ").title(),
                    role=role,
                    password_hash=password_hasher.hash("frontend-test-password"),
                )
            )

    manifest = {
        "username": "e2e-doctor",
        "password": "frontend-test-password",
        "cases": {},
        "datasets": {},
    }
    with TestClient(app) as client:
        token = client.post(
            "/api/v1/auth/login",
            data={"username": "e2e-admin", "password": manifest["password"]},
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        for name, kind in [
            ("Approved", "NIFTI"),
            ("Corrected", "NIFTI"),
            ("Needs correction", "NIFTI"),
            ("Rejected", "NIFTI"),
            ("Locked", "NIFTI"),
            ("PNG", "COCO"),
            ("JPEG", "COCO"),
            ("DICOM", "DICOM"),
        ]:
            source = root / "import" / name
            if kind == "NIFTI":
                (source / "images").mkdir(parents=True)
                (source / "labels").mkdir()
                nib.save(
                    nib.Nifti1Image(np.zeros((4, 5, 6), dtype=np.int16), np.eye(4)),
                    source / "images/case_0001.nii.gz",
                )
                nib.save(
                    nib.Nifti1Image(np.zeros((4, 5, 6), dtype=np.int16), np.eye(4)),
                    source / "labels/case_0001.nii.gz",
                )
                formats = ("3D", "NIFTI", "NIFTI")
            elif kind == "COCO":
                (source / "images").mkdir(parents=True)
                (source / "annotations").mkdir()
                suffix = "png" if name == "PNG" else "jpg"
                filename = f"image_0001.{suffix}"
                image = Image.new("RGB", (320, 240), "#182b28")
                draw = ImageDraw.Draw(image)
                draw.ellipse(
                    (75, 30, 245, 210), fill="#78918b", outline="#e4ece8", width=3
                )
                draw.ellipse((115, 70, 205, 170), fill="#c1d1ca")
                image.save(source / "images" / filename)
                document = {
                    "images": [
                        {"id": 1, "file_name": filename, "width": 320, "height": 240}
                    ],
                    "annotations": [],
                    "categories": [{"id": 1, "name": "test-region"}],
                }
                (source / "annotations/instances.json").write_text(json.dumps(document))
                formats = ("2D", name, "COCO")
            else:
                source.mkdir(parents=True)
                study, series = generate_uid(), generate_uid()
                for index in range(2):
                    path = source / f"{index}.dcm"
                    meta = FileMetaDataset()
                    meta.TransferSyntaxUID = ExplicitVRLittleEndian
                    meta.MediaStorageSOPClassUID = CTImageStorage
                    meta.MediaStorageSOPInstanceUID = generate_uid()
                    ds = FileDataset(
                        str(path), {}, file_meta=meta, preamble=b"\0" * 128
                    )
                    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
                    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
                    ds.SOPClassUID = CTImageStorage
                    ds.Modality, ds.SeriesDescription = "CT", "Generated test series"
                    ds.Rows, ds.Columns, ds.InstanceNumber = 4, 5, index + 1
                    ds.save_as(path, enforce_file_format=True)
                formats = ("3D", "DICOM", "NONE")
            dimension, image_format, annotation_format = formats
            response = client.post(
                "/api/v1/datasets",
                headers=headers,
                json={
                    "name": f"{name} test dataset",
                    "dimension": dimension,
                    "image_format": image_format,
                    "annotation_format": annotation_format,
                },
            )
            assert response.status_code == 201, response.text
            dataset = response.json()
            result = client.post(
                f"/api/v1/datasets/{dataset['id']}/ingest",
                headers=headers,
                json={"type": kind, "path": str(source)},
            )
            assert result.status_code == 201, result.text
            case = client.get(
                f"/api/v1/datasets/{dataset['id']}/cases", headers=headers
            ).json()[0]
            manifest["datasets"][name] = dataset
            manifest["cases"][name] = case
        other_token = client.post(
            "/api/v1/auth/login",
            data={"username": "e2e-other", "password": manifest["password"]},
        ).json()["access_token"]
        client.post(
            f"/api/v1/cases/{manifest['cases']['Locked']['id']}/reviews",
            headers={"Authorization": f"Bearer {other_token}"},
            json={"decision": "APPROVED"},
        ).raise_for_status()

    correction = root / "corrected.nii.gz"
    nib.save(
        nib.Nifti1Image(np.full((4, 5, 6), 2, dtype=np.int16), np.eye(4)), correction
    )
    manifest["correction"] = str(correction)
    (frontend / ".e2e").mkdir(exist_ok=True)
    (frontend / ".e2e/fixtures.json").write_text(json.dumps(manifest))
    uvicorn.run(app, host="127.0.0.1", port=18081, log_level="warning")
