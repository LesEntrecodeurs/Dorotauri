export interface SshHost {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string | null;
  keyPath: string | null;
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshHostGroup {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  hostCount: number;
  createdAt: string;
  updatedAt: string;
}
