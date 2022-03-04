import { CliqueClient } from "alephium-js"
import { Contract } from "./contract"

async function test() {
    const client = new CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const x = await Contract.fromContractPath(client, "add.ral")
    console.log(`hello ${x}`)
}

test()