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
