import { CliqueClient } from "alephium-js"
import { Contract, TestContractParams, Script } from "./contract"
import { Signer } from "./signer"

(BigInt.prototype as any).toJSON = function () {
    return this.toString()
}

async function test() {
    const client = new CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const add = await Contract.from(client, "add.ral")
    console.log(`add:\n${add}`)

    const sub = await Contract.from(client, "sub.ral")
    console.log(`sub: \n${sub}`)

    const subTestAddress = Contract.randomAddress()
    const subState = sub.toState([0], { alphAmount: 1000000000000000000n }, subTestAddress)
    const testParams: TestContractParams = {
        initialFields: [0],
        testArgs: [subTestAddress, 2, 1],
        existingContracts: [subState]
    }
    const testResult = await add.test(client, "add", testParams)
    console.log(`test result:`)
    console.log(JSON.stringify(testResult, null, 2))

    const signer = new Signer(client, "sdk", "1Fy87bs7v1WbaRhccyADDnyG8X9w7duhUBFjGxdvdnYMN")

    const subDeployTx = await sub.transactionForDeployment(signer, [0])
    console.log("sub tx result:")
    console.log(JSON.stringify(subDeployTx, null, 2))
    const subSubmitResult = await signer.submitTransaction(subDeployTx.unsignedTx, subDeployTx.hash)
    console.log("sub submission result:")
    console.log(JSON.stringify(subSubmitResult, null, 2))

    const addDeployTx = await add.transactionForDeployment(signer, [0])
    console.log("add tx result:")
    console.log(JSON.stringify(addDeployTx, null, 2))
    const addSubmitResult = await signer.submitTransaction(addDeployTx.unsignedTx, addDeployTx.hash)
    console.log("add submission result:")
    console.log(JSON.stringify(addSubmitResult, null, 2))

    const subAddress = subDeployTx.contractAddress
    const addAddress = addDeployTx.contractAddress
    const main = await Script.from(client, "main.ral", { addAddress: addAddress, subAddress: subAddress })
    console.log(`main:\n${main}`)

    const mainScriptTx = await main.transactionForDeployment(signer)
    console.log("main tx result:")
    console.log(JSON.stringify(mainScriptTx, null, 2))
    const mainSubmitResult = await signer.submitTransaction(mainScriptTx.unsignedTx, mainScriptTx.txId)
    console.log("main submission result:")
    console.log(JSON.stringify(mainSubmitResult, null, 2))
}

test().catch(error => console.log(error))
