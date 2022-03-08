import { CliqueClient } from "alephium-js"
import { Contract, TestContractParams } from "./contract"
import { Signer } from "./signer"

(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

async function test() {
    const client = new CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const add = await Contract.from(client, "add.ral")
    console.log(`add:\n${add}`)

    const sub = await Contract.from(client, "sub.ral")
    console.log(`sub: \n${sub}`)

    const subAddress = Contract.randomAddress()
    const subState = sub.toState([0], { alphAmount: 1000000000000000000n }, subAddress)
    const testParams: TestContractParams = {
        initialFields: [0],
        testArgs: [subAddress, 2, 1],
        existingContracts: [subState]
    }
    const testResult = await add.test(client, "add", testParams)
    console.log(`test result:`)
    console.log(JSON.stringify(testResult, null, 2))

    const signer = new Signer(client, "sdk", "1Fy87bs7v1WbaRhccyADDnyG8X9w7duhUBFjGxdvdnYMN")
    const deployTx = await add.transactionForDeployment(signer, [0])
    console.log("unsigned tx result:")
    console.log(JSON.stringify(deployTx, null, 2))

    const submitResult = await signer.submitTransaction(deployTx.unsignedTx, deployTx.hash)
    console.log("submission result:")
    console.log(JSON.stringify(submitResult, null, 2))
}

test().catch(error => console.log(error))
