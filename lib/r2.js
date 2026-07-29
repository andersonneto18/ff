import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client = null
function r2() {
  if (client) return client
  client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  return client
}

// Presigned URL the browser uses to PUT the video file directly to R2 (bypasses our server entirely)
export async function getUploadUrl(key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  })
  return getSignedUrl(r2(), cmd, { expiresIn: 600 }) // 10 min to complete the upload
}

// Presigned URL the admin browser uses to stream/view the video (bucket is private)
export async function getViewUrl(key) {
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
  return getSignedUrl(r2(), cmd, { expiresIn: 3600 }) // 1h to view
}
