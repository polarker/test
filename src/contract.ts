import * as crypto from "crypto-js"
import { promises as fsPromises } from "fs"
import { CliqueClient } from "alephium-js"
import * as api from "alephium-js/api/api-alephium"

function isNull(x): boolean {
    return x === null || x === undefined
}

export class Contract {
    fileName: string
    sourceCodeSha256: string
    bytecode: string
    fields: api.Fields
    functions: api.Function[]
    events: api.Event[]

    constructor(fileName: string,
                sourceCodeSha256: string,
                bytecode: string,
                fields: api.Fields,
                functions: api.Function[],
                events: api.Event[]
    ) {
        this.fileName = fileName
        this.sourceCodeSha256 = sourceCodeSha256
        this.bytecode = bytecode
        this.fields = fields
        this.functions = functions
        this.events = events
    }

    private static _contractPath(fileName: string): string {
        return `./contracts/${fileName}`
    }

    private static _artifactPath(fileName: string): string {
        return `./artifacts/${fileName}.json`
    }

    static async from(client: CliqueClient, fileName: string): Promise<Contract> {
        const contractPath = Contract._contractPath(fileName)
        const contract = await fsPromises.readFile(contractPath)
        const contractStr = contract.toString()
        const contractHash = crypto.SHA256(contractStr).toString()

        try {
            const existingContract = await this.loadContract(fileName)
            if (existingContract.sourceCodeSha256 === contractHash) {
                console.log("the contract is already compiled")
                return existingContract
            } else {
                return Contract._from(client, fileName, contractStr, contractHash)
            }
        } catch(_) {
            return Contract._from(client, fileName, contractStr, contractHash)
        }
    }

    private static async _from(client: CliqueClient, fileName: string, contractStr: string, contractHash: string): Promise<Contract> {
        const compiled = (await client.contracts.postContractsCompileContract({code: contractStr})).data
        if (isNull(compiled.bytecode) || isNull(compiled.fields) || isNull(compiled.functions) || isNull(compiled.events)) {
            throw new Event("Compilation did not return the right data")
        }
        const artifact = new Contract(fileName, contractHash, compiled.bytecode, compiled.fields, compiled.functions, compiled.events)
        await artifact._saveToFile()
        return artifact
    }

    static async loadContract(fileName: string): Promise<Contract> {
        const artifactPath = Contract._artifactPath(fileName)
        const content = await fsPromises.readFile(artifactPath)
        const artifact = JSON.parse(content.toString())
        if (isNull(artifact.bytecode) || isNull(artifact.fields) || isNull(artifact.functions) || isNull(artifact.events)) {
            throw new Event("Compilation did not return the right data")
        }
        return new Contract(fileName, artifact.sourceCodeSha256, artifact.bytecode, artifact.fields, artifact.functions, artifact.events)
    }

    private _saveToFile(): Promise<void> {
        const artifactPath = Contract._artifactPath(this.fileName)
        return fsPromises.writeFile(artifactPath, this.toString())
    }

    toString(): string {
        return JSON.stringify({ sourceCodeSha256: this.sourceCodeSha256, bytecode: this.bytecode, fields: this.fields, functions: this.functions, events: this.events }, null, 2)
    }

    async test(client: CliqueClient, funcName: string, params: TestContractParams): Promise<api.TestContractResult> {
        const apiParams: api.TestContract = this.toTestContract(funcName, params)
        return client.contracts.postContractsTestContract(apiParams).then(response => response.data)
    }

    toApiFields(fields?: Val[]): api.Val[] {
        if (isNull(fields)) {
            return undefined
        } else {
            return toApiFields(fields, this.fields.types)
        }
    }

    toApiArgs(funcName: string, args?: Val[]): api.Val[] {
        if (isNull(args)) {
            return undefined
        } else {
            const func = this.functions.find(func => func.name == funcName)
            if (isNull(func)) {
                throw new Error(`Invalid function name: ${funcName}`)
            }

            if (args.length === func.argTypes.length) {
                return args.map((arg, index) => toApiVal(arg, func.argTypes[index]))
            } else {
                throw new Error(`Invalid number of arguments: ${args}`)
            }
        }
    }

    getMethodIndex(funcName: string): number {
        return this.functions.findIndex(func => func.name === funcName)
    }

    toTestContract(funcName: string, params: TestContractParams): api.TestContract {
        return {
            group: params.group,
            contractId: params.contractId,
            bytecode: this.bytecode,
            initialFields: this.toApiFields(params.initialFields),
            initialAsset: toApiAsset(params.initialAsset),
            testMethodIndex: this.getMethodIndex(funcName),
            testArgs: this.toApiArgs(funcName, params.testArgs),
            existingContracts: toApiContractStates(params.existingContracts),
            inputAssets: toApiInputAssets(params.inputAssets)
        }
    }
}

type Number256 = number | bigint
type Val = Number256 | boolean | string

function extractBoolean(v: Val): boolean {
    if (typeof v === "boolean") {
        return v
    } else {
        throw new Error(`Invalid boolean value: ${v}`)
    }
}

// TODO: check integer bounds
function extractNumber256(v: Val): string {
    if ((typeof v === "number" && Number.isInteger(v)) || typeof v === "bigint") {
        return v.toString()
    } else {
        throw new Error(`Invalid 256 bit number: ${v}`)
    }
}

// TODO: check the format of hex string and base58 string
function extractString(v: Val): string {
    if (typeof v === "string") {
        return v
    } else {
        throw new Error(`Invalid string: ${v}`)
    }
}

function toApiVal(v: Val, tpe: string): api.Val {
    if (tpe === "Bool") {
        return { value: extractBoolean(v), type: tpe }
    } else if (tpe === "U256" || tpe === "I256") {
        return { value: extractNumber256(v), type: tpe }
    } else if (tpe === "ByteVec" || tpe === "Address") {
        return { value: extractString(v), type: tpe }
    } else {
        throw new Error(`Invalid Val type: ${tpe}`)
    }
}

interface Asset {
  alphAmount: Number256
  tokens: Token[]
}

interface Token {
  id: string
  amount: Number256
}

function toApiToken(token: Token): api.Token {
    return { id: token.id, amount: extractNumber256(token.amount) }
}

function toApiAsset(asset?: Asset): api.Asset2 {
    if (isNull(asset)) {
        return undefined
    } else {
        return {
            alphAmount: extractNumber256(asset.alphAmount),
            tokens: asset.tokens.map(toApiToken)
        }
    }
}

interface ExistingContract {
  id: string
  code: string
  fields: Val[]
  asset: Asset
}

interface InputAsset {
  address: string
  asset: Asset
}

interface ContractState {
  id: string
  code: string
  fields: Val[]
  fieldTypes: string[]
  asset: Asset
}

function toApiContractState(state: ContractState): api.ContractState {
    return {
        id: state.id,
        code: state.code,
        fields: toApiFields(state.fields, state.fieldTypes),
        asset: toApiAsset(state.asset),
    }
}

function toApiContractStates(states?: ContractState[]): api.ContractState[] {
    if (isNull(states)) {
        return undefined
    } else {
        return states.map(toApiContractState)
    }
}

function toApiFields(fields: Val[], fieldTypes: string[]): api.Val[] {
    if (fields.length === fieldTypes.length) {
        return fields.map((field, index) => toApiVal(field, fieldTypes[index]))
    } else {
        throw new Error(`Invalid number of fields: ${fields}`)
    }
}

interface InputAsset {
  address: string
  asset: Asset
}

function toApiInputAsset(inputAsset: InputAsset): api.InputAsset {
    return { address: inputAsset.address, asset: toApiAsset(inputAsset.asset) }
}

function toApiInputAssets(inputAssets?: InputAsset[]): api.InputAsset[] {
    if (isNull(inputAssets)) {
        return undefined
    } else {
        return inputAssets.map(toApiInputAsset)
    }
}

export interface TestContractParams {
    group?: number; // default 0
    contractId?: string; // default zero hash
    initialFields?: Val[]; // default no fields
    initialAsset?: Asset; // default 1 ALPH
    testMethodIndex?: number; // default 0
    testArgs?: Val[]; // default no arguments
    existingContracts?: ContractState[]; // default no existing contracts
    inputAssets?: InputAsset[]; // default no input asserts
}
