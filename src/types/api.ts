export type Decision =
  "APPROVED" | "MODIFIED" | "NEEDS_CORRECTION" | "REJECTED";
export type CaseStatus = "PENDING" | "IN_REVIEW" | Decision;
export type AnnotationFormat = "NIFTI" | "COCO" | "NONE";
export type ImageFormat = "NIFTI" | "DICOM" | "PNG" | "JPEG";

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: "ADMIN" | "REVIEWER";
  created_at: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string | null;
  dimension: "2D" | "3D";
  image_format: ImageFormat;
  annotation_format: AnnotationFormat;
  created_at: string;
}

export interface Annotation {
  id: string;
  case_id: string;
  version: number;
  annotation_path: string;
  format: AnnotationFormat;
  parent_id: string | null;
  created_by: string;
  created_at: string;
  url: string;
}

export interface Case {
  id: string;
  dataset_id: string;
  case_uid: string;
  dimension: Dataset["dimension"];
  image_format: ImageFormat;
  annotation_format: AnnotationFormat;
  status: CaseStatus;
  image_url: string | null;
  image_urls: string[];
  annotation_url: string | null;
  current_annotation: Annotation | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  case_id: string;
  reviewer_id: string;
  annotation_version_id: string | null;
  decision: Decision;
  comment: string | null;
  created_at: string;
  submitted_at: string | null;
}

export interface CaseSummary {
  id: string;
  case_uid: string;
  status: CaseStatus;
}

export interface ViewerAxis {
  index: number;
  name: string;
  count: number;
  rows: number;
  columns: number;
  row_mm: number;
  column_mm: number;
}

export interface ViewerLabel {
  value: number;
  name: string;
}

export interface ViewerInfo {
  shape: number[];
  spacing: number[];
  axes: ViewerAxis[];
  level: number;
  width: number;
  range: number[];
  labels: ViewerLabel[];
  annotation_format: AnnotationFormat;
  editable: boolean;
  has_mask: boolean;
  has_draft: boolean;
  draft: {
    base_annotation_id: string | null;
    base_version: number | null;
  } | null;
  current_annotation: Annotation | null;
}
