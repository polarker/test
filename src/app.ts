import * as alephium from "alephium-js"
import { promises as fsPromises } from "fs"
import * as crypto from "crypto-js"
import { CliqueClient } from "alephium-js"

class Artifact {
    contractSha256: string
    bytecode: string

    constructor(contractSha256: string, bytecode: string) {
        this.contractSha256 = contractSha256
        this.bytecode = bytecode
    }

    static async fromContractPath(client: CliqueClient, fileName: string): Promise<Artifact> {
        const contract = await fsPromises.readFile(`./contracts/${fileName}`)
        const contractStr = contract.toString()
        const contractHash = crypto.SHA256(contractStr).toString()
        const compiled = await client.contracts.postContractsCompileContract({code: contractStr})

        return new Artifact(contractHash, compiled.data.code)
    }

    toString(): string {
        return JSON.stringify({ contractSha256: this.contractSha256, bytecode: this.bytecode }, null, 2)
    }
}

async function test() {
    const client = new alephium.CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const x = await Artifact.fromContractPath(client, "add.ral")
    console.log(`hello ${x}`)
}

test()