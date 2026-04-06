"use client";

import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./config";

export async function uploadPhoto(file: File, folder: string): Promise<string> {
  const filePath = `${folder}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, filePath);
  const snapshot = await uploadBytesResumable(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

export async function deletePhoto(url: string): Promise<void> {
  try {
    const storageRef = ref(storage, url);
    await deleteObject(storageRef);
  } catch {
    // Silently ignore delete errors (photo may not exist)
  }
}

export async function processPhotos(
  photos: Array<{ file?: File; url?: string; isNew: boolean }>,
  initialUrls: string[],
  folder: string
): Promise<string[]> {
  const uploadPromises = photos.map((photo) => {
    if (photo.isNew && photo.file) {
      return uploadPhoto(photo.file, folder);
    }
    return Promise.resolve(photo.url!);
  });

  const finalUrls = await Promise.all(uploadPromises);

  // Delete removed photos
  const finalUrlSet = new Set(finalUrls);
  const urlsToDelete = initialUrls.filter((url) => !finalUrlSet.has(url));
  await Promise.all(urlsToDelete.map(deletePhoto));

  return finalUrls;
}
