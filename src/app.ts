import { CliqueClient } from "alephium-js"
import { Contract } from "./contract"

async function test() {
    const client = new CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const contract = await Contract.from(client, "add.ral")
    console.log(`contract:\n${contract}`)

    const result = await contract.test(client, "add", {initialFields: [0], testArgs: [1, 2]})
    console.log(`test result:`)
    console.log(result)
}

test().catch(error => console.log(error))