/** File name without the NIfTI extension, used to pair an image with its mask. */
function stem(name: string): string {
  return name.replace(/\.nii(\.gz)?$/i, "");
}

interface Pairing {
  image: File;
  label: File | null;
}

/**
 * Pair every image with a segmentation: same name first, then a mask whose name
 * starts with the image's, which is how KiTS and similar sets name them
 * (`case_00000.nii.gz` and `case_00000_segmentations_v5.nii.gz`). The pairing is
 * shown before uploading, so a mask is never silently ignored.
 */
export function pairFiles(
  images: File[],
  labels: File[],
): { pairs: Pairing[]; unmatched: File[] } {
  const pool = [...labels];
  const take = (match: (label: File) => boolean) => {
    const index = pool.findIndex(match);
    return index < 0 ? null : pool.splice(index, 1)[0];
  };
  const pairs = images.map((image) => ({
    image,
    label:
      take((label) => stem(label.name) === stem(image.name)) ||
      take((label) => stem(label.name).startsWith(stem(image.name) + "_")),
  }));
  return { pairs, unmatched: pool };
}
