export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: string | null
  permissions: string | null
}

export interface LocalEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: string | null
}

export interface Transfer {
  id: string
  fileName: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  percent: number
  status: 'pending' | 'transferring' | 'completed' | 'error'
  error?: string
}
