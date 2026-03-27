export interface SftpHost {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  authType: 'password' | 'key'
  password: string | null
  keyPath: string | null
  createdAt: string
  updatedAt: string
}
