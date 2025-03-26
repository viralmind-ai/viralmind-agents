export interface GuacamoleConnection {
  name: string;
  parentIdentifier: string;
  protocol: string;
  parameters: {
    [key: string]: string;
  };
  attributes: {
    [key: string]: string;
  };
}

export interface ActiveConnection {
  identifier: string;
  connectionIdentifier: string;
  startDate: number;
  remoteHost: string;
  username: string;
  connectable: boolean;
}

export interface FrameInfo {
  timestamp: number;
  buffer: Buffer;
}
