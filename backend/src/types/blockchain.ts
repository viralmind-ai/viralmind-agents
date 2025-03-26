export type IDLAccountField = {
  name: string;
  writable?: boolean;
  signer?: boolean;
  address?: string;
  pda?: {
    seeds: Array<{
      kind: string;
      value: number[];
    }>;
  };
};

export type IDLArgument = {
  name: string;
  type:
    | {
        array?: [string, number];
      }
    | string;
};

export type IDLMetadata = {
  name: string;
  version: string;
  spec: string;
  description: string;
};

export interface IDL {
  address: string;
  metadata: IDLMetadata;
  instructions: Array<{
    name: string;
    discriminator: number[];
    accounts: IDLAccountField[];
    args: IDLArgument[];
  }>;
  accounts: Array<{
    name: string;
    discriminator: number[];
  }>;
  events: Array<{
    name: string;
    discriminator: number[];
  }>;
  errors: Array<{
    code: number;
    name: string;
    msg: string;
  }>;
  types: Array<{
    name: string;
    type: {
      kind: string;
      fields?: Array<{
        name: string;
        type: string | { array: [string, number] } | { defined: { name: string } };
      }>;
      variants?: Array<{
        name: string;
      }>;
    };
  }>;
}
