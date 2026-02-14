import {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    deleteDoc,
    doc,
    updateDoc,
    setDoc,
    getDoc,
    getDocs,
    writeBatch,
    arrayRemove
} from "firebase/firestore";
import { db } from "./firebase";

// ─── Highlight Types & Functions ─────────────────────────────────────

export type HighlightType = 'KeyPoint' | 'Question' | 'Action' | 'Quote' | 'Evidence' | 'None' | 'Snapshot';

export interface Highlight {
    id?: string;
    userId: string;
    videoId: string;
    startSec: number;
    endSec: number;
    text: string;
    type: HighlightType;
    comment?: string;
    imageUrl?: string; // URL for snapshot image
    // Granular highlighting support
    startSegmentStart?: number; // Time of the starting segment
    endSegmentStart?: number;   // Time of the ending segment
    startOffset?: number;       // Character offset in start segment
    endOffset?: number;         // Character offset in end segment
    tag?: string;
    createdAt?: any;
}

export const addHighlight = async (highlight: Omit<Highlight, 'id' | 'createdAt'>) => {
    if (!db) throw new Error("Firestore not initialized");

    return addDoc(collection(db, "highlights"), {
        ...highlight,
        createdAt: serverTimestamp()
    });
};

export const deleteHighlight = async (id: string) => {
    if (!db) throw new Error("Firestore not initialized");
    return deleteDoc(doc(db, "highlights", id));
};

export const updateHighlight = async (id: string, data: Partial<Omit<Highlight, 'id'>>) => {
    if (!db) throw new Error("Firestore not initialized");
    return updateDoc(doc(db, "highlights", id), data);
};

export const subscribeHighlights = (videoId: string, userId: string, callback: (highlights: Highlight[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "highlights"),
        where("videoId", "==", videoId),
        where("userId", "==", userId),
        orderBy("startSec", "asc")
    );

    return onSnapshot(q, (snapshot) => {
        const highlights: Highlight[] = [];
        snapshot.forEach((doc) => {
            highlights.push({ id: doc.id, ...doc.data() } as Highlight);
        });
        callback(highlights);
    }, (error) => {
        console.error("Error in subscribeHighlights:", error);
    });
};

// ─── Tag Types & Functions ───────────────────────────────────────────
// Stored at: tags collection (top-level, filtered by userId)

export interface Tag {
    id: string;
    name: string;
}

export const subscribeTags = (
    userId: string,
    callback: (tags: Tag[]) => void
) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "tags"),
        where("userId", "==", userId)
    );

    return onSnapshot(q, (snapshot) => {
        const tags: Tag[] = [];
        snapshot.forEach((d) => {
            tags.push({ id: d.id, name: d.data().name } as Tag);
        });
        tags.sort((a, b) => a.name.localeCompare(b.name));
        callback(tags);
    });
};

export const addTag = async (userId: string, name: string): Promise<Tag> => {
    if (!db) throw new Error("Firestore not initialized");

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Tag name cannot be empty");

    const docRef = await addDoc(collection(db, "tags"), {
        userId,
        name: trimmed,
        createdAt: serverTimestamp()
    });

    return { id: docRef.id, name: trimmed };
};

export const deleteTag = async (id: string) => {
    if (!db) throw new Error("Firestore not initialized");
    return deleteDoc(doc(db, "tags", id));
};

// ─── Category Types & Functions ──────────────────────────────────────
// Stored at: users/{userId}/categories/{categoryId}

export interface Category {
    id: string;
    name: string;
}

/**
 * Subscribe to real-time category list for a user.
 * Stored at: categories collection (top-level, filtered by userId)
 */
export const subscribeCategories = (
    userId: string,
    callback: (categories: Category[]) => void
) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "categories"),
        where("userId", "==", userId)
    );

    return onSnapshot(q, (snapshot) => {
        const categories: Category[] = [];
        snapshot.forEach((d) => {
            categories.push({ id: d.id, name: d.data().name } as Category);
        });
        categories.sort((a, b) => a.name.localeCompare(b.name));
        callback(categories);
    });
};

/**
 * Add a new category for a user.
 * Duplicate check should be done client-side before calling this.
 */
export const addCategory = async (userId: string, name: string): Promise<Category> => {
    if (!db) throw new Error("Firestore not initialized");

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name cannot be empty");

    const docRef = await addDoc(collection(db, "categories"), {
        userId,
        name: trimmed,
        createdAt: serverTimestamp()
    });

    return { id: docRef.id, name: trimmed };
};

/**
 * Delete a category and clear it from all videos that reference it.
 */
export const deleteCategory = async (userId: string, categoryToDelete: Category) => {
    if (!db) throw new Error("Firestore not initialized");

    // 1. Delete the category document
    await deleteDoc(doc(db, "categories", categoryToDelete.id));

    // 2. Remove this category from all videos' categoryIds arrays
    const videosQuery = query(
        collection(db, "videos"),
        where("userId", "==", userId),
        where("categoryIds", "array-contains", categoryToDelete.id)
    );
    const videoDocs = await getDocs(videosQuery);

    if (!videoDocs.empty) {
        const batch = writeBatch(db);
        videoDocs.forEach((vDoc) => {
            batch.update(vDoc.ref, { categoryIds: arrayRemove(categoryToDelete.id) });
        });
        await batch.commit();
    }
};

// ─── Video Metadata & Categories ─────────────────────────────────────
// Stored at: videos/{userId}_{videoId}

export interface VideoRecord {
    videoId: string;
    userId: string;
    title?: string;
    videoUrl?: string;
    categoryIds: string[];
    updatedAt?: any;
}

/**
 * Save/update the categoryIds (array) for a specific video.
 */
export const saveVideoCategories = async (videoId: string, userId: string, categoryIds: string[]) => {
    if (!db) throw new Error("Firestore not initialized");
    const docId = `${userId}_${videoId}`;
    return setDoc(doc(db, "videos", docId), {
        userId,
        videoId,
        categoryIds,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Save video metadata (title, url) — called when a video first loads.
 */
export const saveVideoMeta = async (videoId: string, userId: string, title: string, videoUrl: string) => {
    if (!db) throw new Error("Firestore not initialized");
    const docId = `${userId}_${videoId}`;
    return setDoc(doc(db, "videos", docId), {
        userId,
        videoId,
        title,
        videoUrl,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Get the categoryIds for a specific video.
 * Backward compatible: supports old single categoryId field.
 */
export const getVideoCategories = async (videoId: string, userId: string): Promise<string[]> => {
    if (!db) throw new Error("Firestore not initialized");
    const docId = `${userId}_${videoId}`;
    const docSnap = await getDoc(doc(db, "videos", docId));
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.categoryIds && Array.isArray(data.categoryIds)) return data.categoryIds;
        if (data.categoryId) return [data.categoryId];
        if (data.category) return [data.category];
    }
    return [];
};

/**
 * Subscribe to all videos for a user (for Library page).
 */
export const subscribeUserVideos = (userId: string, callback: (videos: VideoRecord[]) => void) => {
    if (!db) return () => { };
    const q = query(
        collection(db, "videos"),
        where("userId", "==", userId)
    );
    return onSnapshot(q, (snapshot) => {
        const videos: VideoRecord[] = [];
        snapshot.forEach((d) => {
            const data = d.data();
            videos.push({
                videoId: data.videoId,
                userId: data.userId,
                title: data.title || "",
                videoUrl: data.videoUrl || `https://www.youtube.com/watch?v=${data.videoId}`,
                categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds :
                    data.categoryId ? [data.categoryId] : [],
                updatedAt: data.updatedAt
            });
        });
        // Sort by updatedAt descending (most recent first)
        videos.sort((a, b) => {
            const ta = a.updatedAt?.seconds || 0;
            const tb = b.updatedAt?.seconds || 0;
            return tb - ta;
        });
        callback(videos);
    });
};

/**
 * Delete a video and all its highlights from Firestore.
 */
export const deleteVideo = async (videoId: string, userId: string) => {
    if (!db) throw new Error("Firestore not initialized");

    // Delete the video document
    const docId = `${userId}_${videoId}`;
    await deleteDoc(doc(db, "videos", docId));

    // Delete saved transcript (if any)
    await deleteDoc(doc(db, "transcripts", docId)).catch(() => { });

    // Delete all highlights for this video
    const highlightsQuery = query(
        collection(db, "highlights"),
        where("videoId", "==", videoId),
        where("userId", "==", userId)
    );
    const highlightDocs = await getDocs(highlightsQuery);
    if (!highlightDocs.empty) {
        const batch = writeBatch(db);
        highlightDocs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }
};

// ─── Transcript Persistence ──────────────────────────────────────────
// Stored at: transcripts/{userId}_{videoId}

export interface StoredSegment {
    text: string;
    offset: number;  // ms
    duration: number; // ms
}

// Save uploaded SRT segments to Firestore
export const saveTranscript = async (
    videoId: string,
    userId: string,
    segments: StoredSegment[]
) => {
    if (!db) throw new Error("Firestore not initialized");
    const docId = `${userId}_${videoId}`;
    await setDoc(doc(db, "transcripts", docId), {
        videoId,
        userId,
        segments,
        updatedAt: serverTimestamp(),
    });
};

// Get saved transcript from Firestore (returns null if not found)
export const getTranscript = async (
    videoId: string,
    userId: string
): Promise<StoredSegment[] | null> => {
    if (!db) throw new Error("Firestore not initialized");
    const docId = `${userId}_${videoId}`;
    const snap = await getDoc(doc(db, "transcripts", docId));
    if (snap.exists()) {
        return snap.data().segments as StoredSegment[];
    }
    return null;
};
