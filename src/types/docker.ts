export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
  project: string | null;
  service: string | null;
  configFile: string | null;
}

export interface DockerStatus {
  daemonReady: boolean;
  dockerInstalled: boolean;
  colimaInstalled: boolean;
  colimaRunning: boolean;
  binariesInstalled: boolean;
}

export interface SetupProgress {
  step: string;
  progress: number;
}

export interface ContainerStats {
  id: string;
  cpuPerc: string;
  memUsage: string;
  memPerc: string;
}

export interface ContainerMount {
  source: string;
  destination: string;
  mode: string;
}

export interface ContainerNetwork {
  name: string;
  ipAddress: string;
}

export interface ContainerDetail {
  id: string;
  env: string[];
  mounts: ContainerMount[];
  networks: ContainerNetwork[];
  restartPolicy: string;
  cmd: string[];
  entrypoint: string[];
  workingDir: string;
  hostname: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface NetworkMapNode {
  id: string;
  name: string;
  image: string;
  state: string;
  project: string | null;
  ports: string;
  networks: string[];
}

export interface NetworkMapEdge {
  network: string;
  containers: string[];
}

export interface NetworkMap {
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
}

export interface DockerDiskUsage {
  imagesCount: number;
  imagesSize: string;
  containersCount: number;
  containersSize: string;
  volumesCount: number;
  volumesSize: string;
  buildCacheSize: string;
  totalSize: string;
}
