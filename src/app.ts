import { CliqueClient } from "alephium-js"
import { Contract } from "./contract"

async function test() {
    const client = new CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)

    const contract = await Contract.from(client, "add.ral")
    console.log(`hello ${contract}`)
}

try {
    test()
} catch (err) {
    console.log(err.error)
}