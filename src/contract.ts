import * as cryptojs from "crypto-js"
import * as crypto from "crypto"
import * as bs58 from "bs58"
import { promises as fsPromises } from "fs"
import { CliqueClient } from "alephium-js"
import { api } from "alephium-js"
import { Signer } from "./signer"

function isNull(x): boolean {
    return x === null || x === undefined
}

abstract class Common {
    fileName: string
    sourceCodeSha256: string
    bytecode: string
    codeHash: string
    functions: api.Function[]

    static importRegex: RegExp = new RegExp('^import "[a-z][a-z_0-9]*.ral"', 'm')
    static contractRegex: RegExp = new RegExp('^TxContract [A-Z][a-zA-Z0-9]*\\(', 'm')
    static scriptRegex: RegExp = new RegExp('^TxScript [A-Z][a-zA-Z0-9]* \\\{', 'm')
    static variableRegex: RegExp = new RegExp('\\\{\\\{\\s+[a-z][a-zA-Z0-9]*\\s+\\\}\\\}', 'g')

    constructor(fileName: string,
                sourceCodeSha256: string,
                bytecode: string,
                codeHash: string,
                functions: api.Function[]
    ) {
        this.fileName = fileName
        this.sourceCodeSha256 = sourceCodeSha256
        this.bytecode = bytecode
        this.codeHash = codeHash
        this.functions = functions
    }

    protected static _contractPath(fileName: string): string {
        return `./contracts/${fileName}`
    }

    protected static _artifactPath(fileName: string): string {
        return `./artifacts/${fileName}.json`
    }

    protected static _artifactFolder(): string {
        return `./artifacts/`
    }

    static async handleImports(contractStr: string, importsCache: string[], validate: (string) => void): Promise<string> {
        const localImportsCache: string[] = []
        var result = contractStr.replace(Common.importRegex, (match) => { localImportsCache.push(match); return "" })
        for (const myImport of localImportsCache) {
            const fileName = myImport.slice(8, -1)
            if (!importsCache.includes(fileName)) {
                importsCache.push(fileName)
                const importContractStr = await Common._loadContractStr(fileName, importsCache, code => Contract.checkCodeType(fileName, code))
                result = result.concat("\n", importContractStr)
            }
        }
        return result
    }

    protected static _replaceVariables(contractStr: string, variables?: any): string {
        if (isNull(variables)) {
            return contractStr
        } else {
            return contractStr.replace(Common.variableRegex, (match) => {
                const variableName = match.split(/(\s+)/)[2]
                if (variableName in variables) {
                    return variables[variableName].toString()
                } else {
                    throw new Error(`The value of variable ${variableName} is not provided`)
                }
            })
        }
    }

    protected static async _loadContractStr(fileName: string, importsCache: string[], validate: (string) => void): Promise<string> {
        const contractPath = this._contractPath(fileName)
        const contractBuffer = await fsPromises.readFile(contractPath)
        const contractStr = contractBuffer.toString()

        validate(contractStr)
        return Common.handleImports(contractStr, importsCache, validate)
    }

    static checkFileNameExtension(fileName: string): void {
        if (!fileName.endsWith('.ral')) {
            throw new Error('Smart contract file name should end with ".ral"')
        }
    }

    protected static async _from<T extends { sourceCodeSha256: string }>(
        client: CliqueClient,
        fileName: string,
        loadContractStr: (fileName: string, importsCache: string[]) => Promise<string>,
        loadContract: (fileName: string) => Promise<T>,
        __from: (client: CliqueClient, fileName: string, contractStr: string, contractHash: string) => Promise<T>
    ): Promise<T> {
        Common.checkFileNameExtension(fileName)

        const contractStr = await loadContractStr(fileName, [])
        const contractHash = cryptojs.SHA256(contractStr).toString()
        try {
            const existingContract = await loadContract(fileName)
            if (existingContract.sourceCodeSha256 === contractHash) {
                console.log("the code is already compiled")
                return existingContract
            } else {
                return __from(client, fileName, contractStr, contractHash)
            }
        } catch(_) {
            return __from(client, fileName, contractStr, contractHash)
        }
    }

    static async load(fileName: string): Promise<Contract | Script> {
        return Contract.loadContract(fileName).catch(_ => Script.loadContract(fileName))
    }

    protected _saveToFile(): Promise<void> {
        const artifactPath = Common._artifactPath(this.fileName)
        return fsPromises.writeFile(artifactPath, this.toString())
    }
}

export class Contract extends Common {
    fileName: string
    sourceCodeSha256: string
    bytecode: string
    codeHash: string
    fields: api.Fields
    functions: api.Function[]
    events: api.Event[]

    // cache address for contracts
    private _contractAddresses: Map<string, string>

    constructor(fileName: string,
                sourceCodeSha256: string,
                bytecode: string,
                codeHash: string,
                fields: api.Fields,
                functions: api.Function[],
                events: api.Event[]
    ) {
        super(fileName, sourceCodeSha256, bytecode, codeHash, functions)
        this.fields = fields
        this.events = events

        this._contractAddresses = new Map<string, string>()
    }

    static checkCodeType(fileName: string, contractStr: string): void {
        const contractMatches = Contract.contractRegex.exec(contractStr)
        if (isNull(contractMatches)) {
            throw new Error(`No contract found in: ${fileName}`)
        } else if (contractMatches.length > 1) {
            throw new Error(`Multiple contracts in: ${fileName}`)
        } else {}
    }

    static async loadContractStr(fileName: string, importsCache: string[], variables?: any): Promise<string> {
        const result = await Common._loadContractStr(fileName, importsCache, code => Contract.checkCodeType(fileName, code))
        return Common._replaceVariables(result, variables)
    }

    static async from(client: CliqueClient, fileName: string, variables?: any): Promise<Contract> {
        return Common._from(client, fileName,
            (fileName, importCaches) => Contract.loadContractStr(fileName, importCaches, variables),
            Contract.loadContract, Contract.__from)
    }

    private static async __from(client: CliqueClient, fileName: string, contractStr: string, contractHash: string): Promise<Contract> {
        const compiled = (await client.contracts.postContractsCompileContract({code: contractStr})).data
        if (isNull(compiled.bytecode) || isNull(compiled.fields) || isNull(compiled.functions) || isNull(compiled.events)) {
            throw new Event("Compilation did not return the right data")
        }
        const artifact = new Contract(fileName, contractHash, compiled.bytecode, compiled.codeHash, compiled.fields, compiled.functions, compiled.events)
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
        return new Contract(fileName, artifact.sourceCodeSha256, artifact.bytecode, artifact.codeHash, artifact.fields, artifact.functions, artifact.events)
    }

    toString(): string {
        return JSON.stringify({ sourceCodeSha256: this.sourceCodeSha256, bytecode: this.bytecode, codeHash: this.codeHash, fields: this.fields, functions: this.functions, events: this.events }, null, 2)
    }

    toState(fields: Val[], asset: Asset, address?: string): ContractState {
        return {
            fileName: this.fileName,
            address: address,
            bytecode: this.bytecode,
            codeHash: this.codeHash,
            fields: fields,
            fieldTypes: this.fields.types,
            asset: asset
        }
    }

    static randomAddress(): string {
        const bytes = crypto.randomBytes(33)
        bytes[0] = 3
        return bs58.encode(bytes)
    }

    private _randomAddressWithCache(fileName: string): string {
        const address = Contract.randomAddress()
        this._contractAddresses.set(address, fileName)
        return address
    }

    async test(client: CliqueClient, funcName: string, params: TestContractParams): Promise<TestContractResult> {
        this._contractAddresses.clear()
        const apiParams: api.TestContract = this.toTestContract(funcName, params)
        // console.log(JSON.stringify(apiParams, null, 2))
        const response = await client.contracts.postContractsTestContract(apiParams)
        // console.log(JSON.stringify(response.data, null, 2))
        const result = this.fromTestContractResult(response.data)
        // console.log(JSON.stringify(await result, null, 2))
        this._contractAddresses.clear()
        return result
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

    toApiContractState = (state: ContractState): api.ContractState => {
        if (isNull(state.address)) {
            const address = this._randomAddressWithCache(state.fileName)
            return toApiContractState(state, address)
        } else {
            this._contractAddresses.set(state.address, state.fileName)
            return toApiContractState(state, state.address)
        }
    }

    toApiContractStates(states?: ContractState[]): api.ContractState[] {
        if (isNull(states)) {
            return undefined
        } else {
            return states.map(this.toApiContractState)
        }
    }

    toTestContract(funcName: string, params: TestContractParams): api.TestContract {
        const address: string = params.address ?
          this._randomAddressWithCache(this.fileName) :
          (this._contractAddresses.set(params.address, this.fileName), params.address)
        return {
            group: params.group,
            address: address,
            bytecode: this.bytecode,
            initialFields: this.toApiFields(params.initialFields),
            initialAsset: toApiAsset(params.initialAsset),
            testMethodIndex: this.getMethodIndex(funcName),
            testArgs: this.toApiArgs(funcName, params.testArgs),
            existingContracts: this.toApiContractStates(params.existingContracts),
            inputAssets: toApiInputAssets(params.inputAssets)
        }
    }

    static async getContract(codeHash: string): Promise<Contract> {
        const files = await fsPromises.readdir(Common._artifactFolder())
        for (const file of files) {
            if (file.endsWith(".ral.json")) {
                const fileName = file.slice(0, -5)
                const contract = await Common.load(fileName)
                if (contract.codeHash === codeHash) {
                    return contract as Contract
                }
            }
        }

        throw new Error(`Unknown code with codeHash: ${codeHash}`)
    }

    static async getFieldTypes(codeHash: string): Promise<string[]> {
        return Contract.getContract(codeHash).then(contract => contract.fields.types)
    }

    async fromApiContractState(state: api.ContractState): Promise<ContractState> {
        const contract = await Contract.getContract(state.codeHash)
        return {
            fileName: contract.fileName,
            bytecode: state.bytecode,
            codeHash: state.codeHash,
            fields: state.fields.map(fromApiVal),
            fieldTypes: await Contract.getFieldTypes(state.codeHash),
            asset: fromApiAsset(state.asset)
        }
    }

    async fromTestContractResult(result: api.TestContractResult): Promise<TestContractResult> {
        return {
            returns: result.returns.map(fromApiVal),
            gasUsed: result.gasUsed,
            contracts: await Promise.all(result.contracts.map(contract => this.fromApiContractState(contract))),
            txOutputs: result.txOutputs.map(fromApiOutput)
        }
    }

    async transactionForDeployment(signer: Signer, initialFields?: Val[]): Promise<DeployContractTransaction> {
        const params: api.BuildContractDeployTx = {
            fromPublicKey: await signer.getPublicKey(),
            bytecode: this.bytecode,
            initialFields: this.toApiFields(initialFields)
        }
        const response = await signer.client.contracts.postContractsUnsignedTxBuildContract(params)
        return fromApiDeployContractUnsignedTx(response.data)
    }
}

export class Script extends Common {

    constructor(fileName: string,
                sourceCodeSha256: string,
                bytecode: string,
                codeHash: string,
                functions: api.Function[]
    ) {
        super(fileName, sourceCodeSha256, bytecode, codeHash, functions)
    }

    static checkCodeType(fileName: string, contractStr: string): void {
        const scriptMatches = this.scriptRegex.exec(contractStr)
        if (isNull(scriptMatches)) {
            throw new Error(`No script found in: ${fileName}`)
        } else if (scriptMatches.length > 1) {
            throw new Error(`Multiple scripts in: ${fileName}`)
        } else {}
    }

    static async loadContractStr(fileName: string, importsCache: string[], variables?: any): Promise<string> {
        const result = await Common._loadContractStr(fileName, importsCache, code => Script.checkCodeType(fileName, code))
        return await Common._replaceVariables(result, variables)
    }

    static async from(client: CliqueClient, fileName: string, variables?: any): Promise<Script> {
        return Common._from(client, fileName,
            (fileName, importsCache) => Script.loadContractStr(fileName, importsCache, variables),
            Script.loadContract, Script.__from)
    }

    private static async __from(client: CliqueClient, fileName: string, scriptStr: string, contractHash: string): Promise<Script> {
        const compiled = (await client.contracts.postContractsCompileScript({code: scriptStr})).data
        if (isNull(compiled.bytecode) || isNull(compiled.functions)) {
            throw new Event("= Compilation did not return the right data")
        }
        const artifact = new Script(fileName, contractHash, compiled.bytecode, compiled.codeHash, compiled.functions)
        await artifact._saveToFile()
        return artifact
    }

    static async loadContract(fileName: string): Promise<Script> {
        const artifactPath = Common._artifactPath(fileName)
        const content = await fsPromises.readFile(artifactPath)
        const artifact = JSON.parse(content.toString())
        if (isNull(artifact.bytecode) || isNull(artifact.functions)) {
            throw new Event("= Compilation did not return the right data")
        }
        return new Script(fileName, artifact.sourceCodeSha256, artifact.bytecode, artifact.codeHash, artifact.functions)
    }

    toString(): string {
        return JSON.stringify({ sourceCodeSha256: this.sourceCodeSha256, bytecode: this.bytecode, codeHash: this.codeHash, functions: this.functions }, null, 2)
    }

    async transactionForDeployment(signer: Signer, params?: BuildScriptTx): Promise<BuildScriptTxResult> {
        const apiParams: api.BuildScriptTx = {
            fromPublicKey: await signer.getPublicKey(),
            bytecode: this.bytecode,
            alphAmount: params && params.alphAmount ? extractNumber256(params.alphAmount) : undefined,
            gas: params && params.gas ? params.gas : undefined,
            gasPrice: params && params.gasPrice ? extractNumber256(params.gas) : undefined,
            utxosLimit: params && params.utxosLimit ? params.utxosLimit : undefined
        }
        const response = await signer.client.contracts.postContractsUnsignedTxBuildScript(apiParams)
        return response.data
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
    } else if (typeof v === "string") {
        return v
    } else {
        throw new Error(`Invalid 256 bit number: ${v}`)
    }
}

// TODO: check hex string
function extractByteVec(v: Val): string {
    if (typeof v === "string") {
        // try to convert from address to contract id
        try {
            const address = bs58.decode(v)
            if (address.length == 33 && address[0] == 3) {
                return Buffer.from(address.slice(1)).toString('hex')
            }
        } catch(_) {}
        return v as string
    } else {
        throw new Error(`Invalid string: ${v}`)
    }
}

function extractBs58(v: Val): string {
    if (typeof v === "string") {
        try {
            bs58.decode(v)
            return v as string
        } catch(error) {
            throw new Error(`Invalid base58 string: ${v}`)
        }
    } else {
        throw new Error(`Invalid string: ${v}`)
    }
}

function decodeNumber256(n: string): Number256 {
    if (Number.isSafeInteger(Number.parseInt(n))) {
        return Number(n)
    } else {
        return BigInt(n)
    }
}

function toApiVal(v: Val, tpe: string): api.Val {
    if (tpe === "Bool") {
        return { value: extractBoolean(v), type: tpe }
    } else if (tpe === "U256" || tpe === "I256") {
        return { value: extractNumber256(v), type: tpe }
    } else if (tpe === "ByteVec") {
        return { value: extractByteVec(v), type: tpe }
    } else if (tpe === "Address") {
        return { value: extractBs58(v), type: tpe }
    } else {
        throw new Error(`Invalid Val type: ${tpe}`)
    }
}

function fromApiVal(v: api.Val): Val {
    if (v.type === "Bool") {
        return v.value as boolean
    } else if (v.type === "U256" || v.type === "I256" ) {
        return decodeNumber256(v.value as string)
    } else if (v.type === "ByteVec" || v.type === "Address") {
        return v.value as string
    } else {
        throw new Error (`Invalid api.Val type: ${v}`)
    }
}

interface Asset {
    alphAmount: Number256
    tokens?: Token[]
}

interface Token {
    id: string
    amount: Number256
}

function toApiToken(token: Token): api.Token {
    return { id: token.id, amount: extractNumber256(token.amount) }
}

function fromApiToken(token: api.Token): Token {
    return { id: token.id, amount: decodeNumber256(token.amount) }
}

function toApiAsset(asset?: Asset): api.Asset2 {
    if (isNull(asset)) {
        return undefined
    } else {
        return {
            alphAmount: extractNumber256(asset.alphAmount),
            tokens: isNull(asset.tokens) ? undefined : asset.tokens.map(toApiToken)
        }
    }
}

function fromApiAsset(asset: api.Asset2): Asset {
    return {
        alphAmount: decodeNumber256(asset.alphAmount),
        tokens: asset.tokens ? asset.tokens.map(fromApiToken) : undefined
    }
}

interface InputAsset {
    address: string
    asset: Asset
}

export interface ContractState {
  fileName: string
  address?: string
  bytecode: string
  codeHash: string
  fields: Val[]
  fieldTypes: string[]
  asset: Asset
}

function toApiContractState(state: ContractState, address: string): api.ContractState {
    return {
        address: address,
        bytecode: state.bytecode,
        codeHash: state.codeHash,
        fields: toApiFields(state.fields, state.fieldTypes),
        asset: toApiAsset(state.asset),
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
    group?: number // default 0
    address?: string
    initialFields?: Val[] // default no fields
    initialAsset?: Asset // default 1 ALPH
    testMethodIndex?: number // default 0
    testArgs?: Val[] // default no arguments
    existingContracts?: ContractState[] // default no existing contracts
    inputAssets?: InputAsset[] // default no input asserts
}

export interface TestContractResult {
    returns: Val[]
    gasUsed: number
    contracts: ContractState[]
    txOutputs: Output[]
}
export declare type Output = AssetOutput | ContractOutput
export interface AssetOutput extends Asset {
    type: string
    address: string
    lockTime: number
    additionalData: string
}
export interface ContractOutput {
    type: string
    address: string
    alphAmount: Number256
    tokens: Token[]
}

function fromApiOutput(output: api.Output): Output {
    if (output.type === "Asset") {
        const asset = output as api.Asset1
        return {
            type: "AssetOutput",
            address: asset.address,
            alphAmount: decodeNumber256(asset.alphAmount),
            tokens: asset.tokens.map(fromApiToken),
            lockTime: asset.lockTime,
            additionalData: asset.additionalData
        }
    } else if (output.type === "Contract") {
        const asset = output as api.Contract1
        return {
            type: "ContractOutput",
            address: asset.address,
            alphAmount: decodeNumber256(asset.alphAmount),
            tokens: asset.tokens.map(fromApiToken)
        }
    } else {
        throw new Error(`Unknown output type: ${output}`)
    }
}

export interface DeployContractTransaction {
    group: number
    unsignedTx: string
    hash: string
    contractAddress: string
}

function fromApiDeployContractUnsignedTx(result: api.BuildContractDeployTxResult): DeployContractTransaction {
    return result
}

export interface BuildScriptTx {
    alphAmount?: Number256
    gas?: number
    gasPrice?: Number256
    utxosLimit?: number
}

export interface BuildScriptTxResult {
    unsignedTx: string
    txId: string
    group: number
}
