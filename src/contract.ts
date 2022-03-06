import * as crypto from "crypto-js"
import { promises as fsPromises } from "fs"
import { CliqueClient } from "alephium-js"
import * as api from "alephium-js/api/api-alephium"

const isNull = (x): boolean => {
    return x === null || x === undefined
}

export class Contract {
    fileName: string
    sourceCodeSha256: string
    bytecode: string
    fieldsSignature: string
    functions: api.Function[]
    events: api.Event[]

    constructor(fileName: string,
                sourceCodeSha256: string,
                bytecode: string,
                fieldsSignature: string,
                functions: api.Function[],
                events: api.Event[]
    ) {
        this.fileName = fileName
        this.sourceCodeSha256 = sourceCodeSha256
        this.bytecode = bytecode
        this.fieldsSignature = fieldsSignature
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
        if (isNull(compiled.bytecode) || isNull(compiled.fieldsSignature) || isNull(compiled.functions) || isNull(compiled.events)) {
            throw new Event("Compilation did not return the right data")
        }
        const artifact = new Contract(fileName, contractHash, compiled.bytecode, compiled.fieldsSignature, compiled.functions, compiled.events)
        await artifact._saveToFile()
        return artifact
    }

    static async loadContract(fileName: string): Promise<Contract> {
        const artifactPath = Contract._artifactPath(fileName)
        const content = await fsPromises.readFile(artifactPath)
        const artifact = JSON.parse(content.toString())
        return new Contract(fileName, artifact.sourceCodeSha256, artifact.bytecode, artifact.fieldsSignature, artifact.functions, artifact.events)
    }

    private _saveToFile(): Promise<void> {
        const artifactPath = Contract._artifactPath(this.fileName)
        return fsPromises.writeFile(artifactPath, this.toString())
    }

    toString(): string {
        return JSON.stringify({ sourceCodeSha256: this.sourceCodeSha256, bytecode: this.bytecode, fieldsSignature: this.fieldsSignature, functions: this.functions, events: this.events }, null, 2)
    }
}
