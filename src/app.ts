import { CliqueClient } from "alephium-js"
import { Contract, TestContractParams } from "./contract"

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
    const result = await add.test(client, "add", testParams)
    console.log(`test result:`)
    console.log(JSON.stringify(result, null, 2))
}

test().catch(error => console.log(error))
