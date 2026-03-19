import React, { useState, useRef, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { RiviumStorage, RiviumStorageException, ImageTransforms } from '@rivium-storage/react-native';

/// RiviumStorage React Native SDK — Complete Example
///
/// This example demonstrates ALL capabilities of the RiviumStorage SDK:
/// - Bucket operations (list, get by ID, get by name)
/// - File operations (upload, list, get, download, delete)
/// - URL generation (public URL, transform URL, download URL)
/// - Image transformations (resize, format, quality, effects)
/// - Error handling
///
/// How it works:
/// - Only the API key and bucket name are configured manually.
/// - All IDs (bucket ID, file IDs, paths) are captured from API responses
///   and reused by subsequent operations — nothing is hardcoded.
/// - Run the buttons top-to-bottom for the best experience.

// ============================================================
// Configuration — only these two values need to be set
// ============================================================

const API_KEY = 'YOUR_API_KEY';
const BUCKET_NAME = 'YOUR_BUCKET_NAME';
const USER_ID = 'YOUR_USER_ID';

// ============================================================
// Types
// ============================================================

interface LogEntry {
  id: number;
  message: string;
  isError: boolean;
}

// ============================================================
// App
// ============================================================

export default function App() {
  const storage = useRef(new RiviumStorage({ apiKey: API_KEY, userId: USER_ID, timeout: 30000 })).current;
  const logListRef = useRef<FlatList>(null);
  const logIdRef = useRef(0);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  // State captured from API responses — no hardcoded IDs
  const lastBucketId = useRef<string | null>(null);
  const lastFileId = useRef<string | null>(null);
  const lastFilePath = useRef<string | null>(null);
  const lastImageFileId = useRef<string | null>(null);
  const uploadedFileIds = useRef<string[]>([]);

  const log = useCallback((message: string, isError = false) => {
    setLogs(prev => {
      const entry: LogEntry = { id: ++logIdRef.current, message, isError };
      return [...prev, entry];
    });
    setTimeout(() => logListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // ============================================================
  // Bucket Operations
  // ============================================================

  const listBuckets = async () => {
    log('Listing all buckets...');
    try {
      const buckets = await storage.listBuckets();
      log(`Found ${buckets.length} bucket(s):`);
      for (const bucket of buckets) {
        log(`   - ${bucket.name} (${bucket.visibility}) [${bucket.id}]`);
      }
      if (buckets.length > 0) {
        lastBucketId.current = buckets[0].id;
        log('');
        log(`   Stored bucket ID: ${lastBucketId.current} for next operations`);
      }
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const getBucketById = async () => {
    if (!lastBucketId.current) {
      log('No bucket ID available. Run "List All Buckets" first.', true);
      return;
    }
    log(`Getting bucket by ID: ${lastBucketId.current}`);
    try {
      const bucket = await storage.getBucket(lastBucketId.current);
      log(`Bucket: ${bucket.name}`);
      log(`   - ID: ${bucket.id}`);
      log(`   - Visibility: ${bucket.visibility}`);
      log(`   - Policies Enabled: ${bucket.policiesEnabled}`);
      log(`   - Active: ${bucket.isActive}`);
      if (bucket.allowedMimeTypes) {
        log(`   - Allowed MIME: ${bucket.allowedMimeTypes.join(', ')}`);
      }
      if (bucket.maxFileSize) {
        log(`   - Max File Size: ${formatBytes(bucket.maxFileSize)}`);
      }
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const getBucketByName = async () => {
    log(`Getting bucket by name: ${BUCKET_NAME}`);
    try {
      const bucket = await storage.getBucketByName(BUCKET_NAME);
      log(`Found: ${bucket.name} (${bucket.id})`);
      lastBucketId.current = bucket.id;
      log(`   Stored bucket ID: ${bucket.id}`);
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  // ============================================================
  // File Operations
  // ============================================================

  const uploadTextFile = async () => {
    if (!lastBucketId.current) {
      log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
      return;
    }
    const content = `Hello, RiviumStorage! Timestamp: ${Date.now()}`;
    const path = `examples/test-${Date.now()}.txt`;

    log(`Uploading text file: ${path}`);
    try {
      const file = await storage.upload(lastBucketId.current, path, content, {
        contentType: 'text/plain',
        metadata: { author: 'React Native Example', version: '1.0' },
      });
      log(`Uploaded: ${file.fileName}`);
      log(`   - ID: ${file.id}`);
      log(`   - Path: ${file.path}`);
      log(`   - Size: ${formatBytes(file.size)}`);
      log(`   - MIME: ${file.mimeType}`);
      if (file.url) log(`   - URL: ${file.url}`);
      lastFileId.current = file.id;
      lastFilePath.current = file.path;
      uploadedFileIds.current.push(file.id);
      log(`   Stored file ID: ${file.id}`);
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const uploadImage = async () => {
    if (!lastBucketId.current) {
      log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
      return;
    }
    // 1x1 red PNG
    const redPixelPNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const path = `examples/images/sample-${Date.now()}.png`;

    log(`Uploading image: ${path}`);
    try {
      const file = await storage.upload(lastBucketId.current, path, redPixelPNG, {
        contentType: 'image/png',
      });
      log(`Uploaded: ${file.fileName}`);
      log(`   - ID: ${file.id}`);
      log(`   - Size: ${formatBytes(file.size)}`);
      lastImageFileId.current = file.id;
      lastFileId.current = file.id;
      lastFilePath.current = file.path;
      uploadedFileIds.current.push(file.id);
      log(`   Stored image file ID: ${file.id}`);
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const listFiles = async () => {
    if (!lastBucketId.current) {
      log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
      return;
    }
    log('Listing files (prefix: examples/, limit: 10)...');
    try {
      const result = await storage.listFiles(lastBucketId.current, {
        prefix: 'examples/',
        limit: 10,
      });
      log(`Found ${result.files.length} file(s):`);
      for (const file of result.files) {
        log(`   - ${file.path} (${formatBytes(file.size)}) [${file.id}]`);
      }
      if (result.nextCursor) {
        log(`   (More files available, cursor: ${result.nextCursor.substring(0, 20)}...)`);
      }
      if (result.files.length > 0 && !lastFileId.current) {
        lastFileId.current = result.files[0].id;
        lastFilePath.current = result.files[0].path;
        log('');
        log(`   Stored file ID: ${lastFileId.current} from listing`);
      }
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const getFileById = async () => {
    if (!lastFileId.current) {
      log('No file ID available. Upload a file or run "List Files" first.', true);
      return;
    }
    log(`Getting file by ID: ${lastFileId.current}`);
    try {
      const file = await storage.getFile(lastFileId.current);
      log(`Found: ${file.fileName}`);
      log(`   - Path: ${file.path}`);
      log(`   - Size: ${formatBytes(file.size)}`);
      log(`   - MIME: ${file.mimeType}`);
      log(`   - Created: ${file.createdAt}`);
      log(`   - Updated: ${file.updatedAt}`);
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const getFileByPath = async () => {
    if (!lastBucketId.current || !lastFilePath.current) {
      log('No bucket or file path available. Upload a file first.', true);
      return;
    }
    log(`Getting file by path: ${lastFilePath.current}`);
    try {
      const file = await storage.getFileByPath(lastBucketId.current, lastFilePath.current);
      log(`Found: ${file.fileName} (${file.id})`);
      log(`   - Size: ${formatBytes(file.size)}`);
      log(`   - MIME: ${file.mimeType}`);
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const downloadFile = async () => {
    if (!lastFileId.current) {
      log('No file ID available. Upload a file first.', true);
      return;
    }
    log(`Downloading file: ${lastFileId.current}`);
    try {
      const data = await storage.download(lastFileId.current);
      log(`Downloaded ${formatBytes(data.byteLength)}`);
      if (data.byteLength < 200) {
        try {
          const content = new TextDecoder().decode(data);
          log(`   Content: "${content}"`);
        } catch {
          log('   (Binary content)');
        }
      }
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const deleteFile = async () => {
    if (!lastFileId.current) {
      log('No file ID available. Upload a file first.', true);
      return;
    }
    log(`Deleting file: ${lastFileId.current}`);
    try {
      await storage.delete(lastFileId.current);
      log('Deleted successfully');
      uploadedFileIds.current = uploadedFileIds.current.filter(id => id !== lastFileId.current);
      lastFileId.current = uploadedFileIds.current.length > 0
        ? uploadedFileIds.current[uploadedFileIds.current.length - 1]
        : null;
      lastFilePath.current = null;
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const deleteByPath = async () => {
    if (!lastBucketId.current || !lastFilePath.current) {
      log('No bucket or file path available. Upload a file first.', true);
      return;
    }
    log(`Deleting file by path: ${lastFilePath.current}`);
    try {
      await storage.deleteByPath(lastBucketId.current, lastFilePath.current);
      log('Deleted successfully');
      uploadedFileIds.current = uploadedFileIds.current.filter(id => id !== lastFileId.current);
      lastFileId.current = uploadedFileIds.current.length > 0
        ? uploadedFileIds.current[uploadedFileIds.current.length - 1]
        : null;
      lastFilePath.current = null;
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  const deleteMany = async () => {
    if (uploadedFileIds.current.length === 0) {
      log('No uploaded file IDs tracked. Upload some files first.', true);
      return;
    }
    const idsToDelete = [...uploadedFileIds.current];
    log(`Deleting ${idsToDelete.length} file(s): ${idsToDelete.join(', ')}`);
    try {
      const result = await storage.deleteMany(idsToDelete);
      log(`Deleted ${result.deleted} file(s)`);
      uploadedFileIds.current = [];
      lastFileId.current = null;
      lastFilePath.current = null;
      lastImageFileId.current = null;
    } catch (e) {
      if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
      else log(`Error: ${(e as Error).message}`, true);
    }
  };

  // ============================================================
  // URL Generation
  // ============================================================

  const generateUrls = () => {
    if (!lastFileId.current) {
      log('No file ID available. Upload a file first.', true);
      return;
    }
    const fileId = lastFileId.current;

    log(`Generating URLs for file: ${fileId}`);
    log('');

    const publicUrl = storage.getUrl(fileId);
    log('Public URL:');
    log(`   ${publicUrl}`);

    const downloadUrl = storage.getDownloadUrl(fileId);
    log('');
    log('Download URL:');
    log(`   ${downloadUrl}`);

    const thumbnailUrl = storage.getTransformUrl(fileId, { width: 200, height: 200 });
    log('');
    log('Thumbnail URL (200x200):');
    log(`   ${thumbnailUrl}`);

    const advancedUrl = storage.getTransformUrl(fileId, {
      width: 800,
      height: 600,
      fit: 'cover',
      format: 'webp',
      quality: 85,
    });
    log('');
    log('Advanced Transform URL:');
    log(`   ${advancedUrl}`);
  };

  // ============================================================
  // Image Transformations
  // ============================================================

  const showTransforms = () => {
    const fileId = lastImageFileId.current ?? lastFileId.current;
    if (!fileId) {
      log('No file ID available. Upload an image first.', true);
      return;
    }

    log(`Image Transform Examples (file: ${fileId}):`);
    log('='.repeat(50));

    const transforms: Record<string, ImageTransforms> = {
      'Resize 200x200': { width: 200, height: 200 },
      'Width only (auto height)': { width: 400 },
      'Height only (auto width)': { height: 300 },
      'Fit: cover': { width: 200, height: 200, fit: 'cover' },
      'Fit: contain': { width: 200, height: 200, fit: 'contain' },
      'Fit: fill': { width: 200, height: 200, fit: 'fill' },
      'Format: WebP': { width: 200, format: 'webp' },
      'Format: AVIF': { width: 200, format: 'avif' },
      'Format: JPEG': { width: 200, format: 'jpeg' },
      'Quality: 50%': { width: 200, format: 'jpeg', quality: 50 },
      'Quality: 90%': { width: 200, format: 'jpeg', quality: 90 },
      'Blur effect': { width: 200, blur: 10 },
      'Sharpen effect': { width: 200, sharpen: 50 },
      'Rotate 90deg': { rotate: 90 },
      'Rotate 180deg': { rotate: 180 },
      'Rotate 270deg': { rotate: 270 },
      'Combined transforms': {
        width: 400,
        height: 300,
        fit: 'cover',
        format: 'webp',
        quality: 80,
        sharpen: 20,
      },
    };

    for (const [name, opts] of Object.entries(transforms)) {
      const url = storage.getTransformUrl(fileId, opts);
      log('');
      log(`${name}:`);
      log(`   ${url}`);
    }
  };

  // ============================================================
  // Policy Testing Helpers
  // ============================================================

  const ensureBucketForPolicy = async (): Promise<string | null> => {
    if (lastBucketId.current) return lastBucketId.current;
    log('No bucket. Running "List All Buckets" first...');
    await listBuckets();
    if (!lastBucketId.current) log('No bucket available. Create one in the dashboard first.', true);
    return lastBucketId.current;
  };

  const policyTextData = () => `Hello, RiviumStorage! Timestamp: ${Date.now()}`;

  const policyPngData = () => new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const tryUpload = async (bucketId: string, path: string, data: string | Uint8Array, contentType?: string): Promise<string> => {
    try {
      await storage.upload(bucketId, path, data, { contentType: contentType || 'text/plain' });
      return 'ALLOWED';
    } catch {
      return 'DENIED';
    }
  };

  const tryList = async (bucketId: string): Promise<string> => {
    try {
      await storage.listFiles(bucketId, { limit: 1 });
      return 'ALLOWED';
    } catch {
      return 'DENIED';
    }
  };

  // ============================================================
  // Policy Testing
  // ============================================================

  const testNoRules = async () => {
    const bucketId = await ensureBucketForPolicy();
    if (!bucketId) return;

    log('');
    log('========================================');
    log('  TEST: No Rules (no policy on bucket)');
    log('  Dashboard: Delete the policy from bucket');
    log('  When no policy exists, all access is allowed');
    log('========================================');
    log('');
    log(`Current userId: ${storage.userId ?? 'none (unauthenticated)'}`);
    log('');

    const ts = Date.now();
    log(`Upload text file:   ${await tryUpload(bucketId, `test/no-rules-${ts}.txt`, policyTextData())}`);
    log(`Upload image:       ${await tryUpload(bucketId, `test/no-rules-${ts}.png`, policyPngData(), 'image/png')}`);
    log(`List files:         ${await tryList(bucketId)}`);
    log('');
    log('Expected: Everything ALLOWED (no policy = no restrictions)');
  };

  const testPrivate = async () => {
    const bucketId = await ensureBucketForPolicy();
    if (!bucketId) return;

    log('');
    log('========================================');
    log('  TEST: Private Template');
    log('  Dashboard: Apply "Private" template');
    log('  Rule: Allow only authenticated users');
    log('  (default-deny: unauthenticated = denied)');
    log('========================================');
    log('');

    const ts = Date.now();

    log(`-- With userId: ${storage.userId} --`);
    log(`Upload text:   ${await tryUpload(bucketId, `test/private-${ts}.txt`, policyTextData())}`);
    log(`Upload image:  ${await tryUpload(bucketId, `test/private-${ts}.png`, policyPngData(), 'image/png')}`);
    log(`List files:    ${await tryList(bucketId)}`);
    log('');

    const savedUserId = storage.userId;
    storage.setUserId(null);
    log('-- Without userId (unauthenticated) --');
    log(`Upload text:   ${await tryUpload(bucketId, `test/private-anon-${ts}.txt`, policyTextData())}`);
    log(`List files:    ${await tryList(bucketId)}`);
    storage.setUserId(savedUserId);

    log('');
    log('Expected:');
    log('  With userId:    Everything ALLOWED');
    log('  Without userId: Everything DENIED');
  };

  const testPublicRead = async () => {
    const bucketId = await ensureBucketForPolicy();
    if (!bucketId) return;

    log('');
    log('========================================');
    log('  TEST: Public Read Template');
    log('  Dashboard: Apply "Public Read" template');
    log('  Rule: Anyone can read/list,');
    log('        auth required to write/delete');
    log('========================================');
    log('');

    const ts = Date.now();

    log(`-- With userId: ${storage.userId} --`);
    log(`Upload text:   ${await tryUpload(bucketId, `test/public-${ts}.txt`, policyTextData())}`);
    log(`List files:    ${await tryList(bucketId)}`);
    log('');

    const savedUserId = storage.userId;
    storage.setUserId(null);
    log('-- Without userId (unauthenticated) --');
    log(`List files:    ${await tryList(bucketId)}`);
    log(`Upload text:   ${await tryUpload(bucketId, `test/public-anon-${ts}.txt`, policyTextData())}`);
    storage.setUserId(savedUserId);

    log('');
    log('Expected:');
    log('  With userId:    Upload ALLOWED, List ALLOWED');
    log('  Without userId: List ALLOWED, Upload DENIED');
  };

  const testUserFolders = async () => {
    const bucketId = await ensureBucketForPolicy();
    if (!bucketId) return;

    log('');
    log('========================================');
    log('  TEST: User Folders Template');
    log('  Dashboard: Apply "User Folders" template');
    log('  Rule: Auth users can read/list all,');
    log('        write/delete only in users/{userId}/');
    log('========================================');
    log('');

    const uid = storage.userId ?? 'demo-user-123';
    const ts = Date.now();

    log(`-- With userId: ${uid} --`);
    log('');
    log(`Upload to own folder (users/${uid}/):`);
    log(`  users/${uid}/photo.txt:        ${await tryUpload(bucketId, `users/${uid}/photo-${ts}.txt`, policyTextData())}`);
    log(`  users/${uid}/sub/doc.txt:      ${await tryUpload(bucketId, `users/${uid}/sub/doc-${ts}.txt`, policyTextData())}`);
    log('');
    log('Upload to OTHER user folder:');
    log(`  users/other-user/hack.txt:   ${await tryUpload(bucketId, `users/other-user/hack-${ts}.txt`, policyTextData())}`);
    log('');
    log('Upload to root (no user folder):');
    log(`  test/random.txt:             ${await tryUpload(bucketId, `test/random-${ts}.txt`, policyTextData())}`);
    log('');
    log(`List files:                    ${await tryList(bucketId)}`);

    const savedUserId = storage.userId;
    storage.setUserId(null);
    log('');
    log('-- Without userId (unauthenticated) --');
    log(`Upload:   ${await tryUpload(bucketId, `users/anon/test-${ts}.txt`, policyTextData())}`);
    log(`List:     ${await tryList(bucketId)}`);
    storage.setUserId(savedUserId);

    log('');
    log('Expected:');
    log('  Own folder:     ALLOWED');
    log('  Other folder:   DENIED');
    log('  Root path:      DENIED');
    log('  List:           ALLOWED');
    log('  No userId:      DENIED (all)');
  };

  const testImagesOnly = async () => {
    const bucketId = await ensureBucketForPolicy();
    if (!bucketId) return;

    log('');
    log('========================================');
    log('  TEST: Images Only Template');
    log('  Dashboard: Apply "Images Only" template');
    log('  Rule: Anyone can read/list/delete,');
    log('        only auth users can upload images');
    log('        (JPEG/PNG/GIF/WebP, 5MB max)');
    log('========================================');
    log('');

    const ts = Date.now();

    log(`-- With userId: ${storage.userId} --`);
    log('');
    log(`Upload PNG image:        ${await tryUpload(bucketId, `test/image-${ts}.png`, policyPngData(), 'image/png')}`);
    log(`Upload text file:        ${await tryUpload(bucketId, `test/doc-${ts}.txt`, policyTextData(), 'text/plain')}`);
    log(`Upload PDF:              ${await tryUpload(bucketId, `test/doc-${ts}.pdf`, policyTextData(), 'application/pdf')}`);
    log(`List files:              ${await tryList(bucketId)}`);

    const savedUserId = storage.userId;
    storage.setUserId(null);
    log('');
    log('-- Without userId (unauthenticated) --');
    log(`Upload PNG:   ${await tryUpload(bucketId, `test/anon-${ts}.png`, policyPngData(), 'image/png')}`);
    log(`Upload text:  ${await tryUpload(bucketId, `test/anon-${ts}.txt`, policyTextData())}`);
    log(`List files:   ${await tryList(bucketId)}`);
    storage.setUserId(savedUserId);

    log('');
    log('Expected:');
    log('  PNG image:      ALLOWED');
    log('  Text file:      DENIED (not an image)');
    log('  PDF file:       DENIED (not an image)');
    log('  List:           ALLOWED (read is open)');
    log('  No userId PNG:  DENIED (auth required for upload)');
    log('  No userId List: ALLOWED (read is open)');
  };

  // ============================================================
  // Error Handling
  // ============================================================

  const demonstrateErrorHandling = async () => {
    log('Testing error handling with invalid file ID...');
    try {
      await storage.getFile('non-existent-file-id');
    } catch (e) {
      if (e instanceof RiviumStorageException) {
        log('');
        log('Caught RiviumStorageException:');
        log(`   Message: ${e.message}`);
        if (e.statusCode) log(`   Status Code: ${e.statusCode}`);
        if (e.code) log(`   Error Code: ${e.code}`);
        log('');
        log('Error handling example complete!');
      }
    }
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>RiviumStorage SDK Example</Text>
        <TouchableOpacity onPress={clearLogs}>
          <Text style={styles.headerAction}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Buttons section */}
      <ScrollView style={styles.buttonsSection} contentContainerStyle={styles.buttonsContent}>
        <SectionHeader title="Bucket Operations" />
        <ExampleButton label="List All Buckets" onPress={listBuckets} />
        <ExampleButton label="Get Bucket by ID" onPress={getBucketById} />
        <ExampleButton label="Get Bucket by Name" onPress={getBucketByName} />

        <SectionHeader title="File Operations" />
        <ExampleButton label="Upload Text File" onPress={uploadTextFile} />
        <ExampleButton label="Upload Image (PNG)" onPress={uploadImage} />
        <ExampleButton label="List Files" onPress={listFiles} />
        <ExampleButton label="Get File by ID" onPress={getFileById} />
        <ExampleButton label="Get File by Path" onPress={getFileByPath} />
        <ExampleButton label="Download File" onPress={downloadFile} />
        <ExampleButton label="Delete File" onPress={deleteFile} />
        <ExampleButton label="Delete by Path" onPress={deleteByPath} />
        <ExampleButton label="Delete Multiple Files" onPress={deleteMany} />

        <SectionHeader title="URL Generation" />
        <ExampleButton label="Generate All URL Types" onPress={generateUrls} />

        <SectionHeader title="Image Transformations" />
        <ExampleButton label="Show All Transform Options" onPress={showTransforms} />

        <SectionHeader title="Policy Testing" />
        <ExampleButton label="Test: No Rules (allow all)" onPress={testNoRules} />
        <ExampleButton label="Test: Private (login required)" onPress={testPrivate} />
        <ExampleButton label="Test: Public Read" onPress={testPublicRead} />
        <ExampleButton label="Test: User Folders" onPress={testUserFolders} />
        <ExampleButton label="Test: Images Only" onPress={testImagesOnly} />

        <SectionHeader title="Error Handling" />
        <ExampleButton label="Demonstrate Error Handling" onPress={demonstrateErrorHandling} />

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Log header */}
      <View style={styles.logHeader}>
        <Text style={styles.logHeaderTitle}>Output Log</Text>
        <Text style={styles.logHeaderCount}>{logs.length} entries</Text>
      </View>

      {/* Log output */}
      <FlatList
        ref={logListRef}
        style={styles.logSection}
        contentContainerStyle={styles.logContent}
        data={logs}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <Text style={[styles.logText, item.isError && styles.logTextError]}>
            {item.message}
          </Text>
        )}
      />
    </SafeAreaView>
  );
}

// ============================================================
// UI Components
// ============================================================

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      <View style={styles.sectionDivider} />
    </View>
  );
}

function ExampleButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#E8DEF8',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  headerAction: {
    fontSize: 14,
    color: '#6750A4',
    fontWeight: '600',
  },
  buttonsSection: {
    flex: 2,
  },
  buttonsContent: {
    padding: 16,
  },
  sectionHeader: {
    marginTop: 16,
    marginBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6750A4',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#CAC4D0',
    marginTop: 6,
  },
  button: {
    backgroundColor: '#6750A4',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 4,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#CAC4D0',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F5F5F5',
  },
  logHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  logHeaderCount: {
    fontSize: 12,
    color: '#79747E',
  },
  logSection: {
    flex: 3,
    backgroundColor: '#1C1B1F',
  },
  logContent: {
    padding: 12,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#A8DB8F',
    lineHeight: 18,
  },
  logTextError: {
    color: '#F2B8B5',
  },
});
