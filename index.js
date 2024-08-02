const {MongoClient} = require('mongodb');
const express = require("express")
const cors = require("cors")
const bcrypt = require("bcrypt")
const fs = require("fs")
require('dotenv').config();
const mailjet = require('node-mailjet').apiConnect(
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE
)

const app = express()
app.use(cors())
app.use(express.json())
app.use(limiter)

const url = process.env.MONGO_URL;
const client = new MongoClient(url);

const dbName = 'faser';

async function getLanguages() {
    return JSON.parse(fs.readFileSync("./supportedLanguages.json", "utf8"))
}

app.get("/", (req, res) => {
    res.send("Hello from the backend :)")
})

async function getMessages(lang, message) {
    const language = await getLanguages()

    for(let i = 0; i < language.length; i++) {

        if (await language[i].short === lang) {

            for(let j = 0; j < language[i].messages.length; j++) {

                if(language[i].messages[j].name === message) {
                    return language[i].messages[j].desc
                }

            }

        }
    }

    for(let j = 0; j < language[0].messages.length; j++) {

        if(language[0].messages[j].name === message) {
            return language[0].messages[j].desc
        }

    }

}


async function checkId(id) {
    const db = client.db(dbName);
    const collection = db.collection('accounts');

    const checkId = await collection.find({id: id}).toArray()

    return checkId.length > 0;
}

app.post("/api/account/createAccount", async (req, res) => {
    await client.connect()
    const db = client.db(dbName);
    const collection = db.collection('accounts');
    const {email, username, password, lang} = req.body

    const getAccountsByEmail = await collection.find({email: req.body.email}).toArray();

    if (getAccountsByEmail.length > 0) {
        res.status(400).send(
            {
                status: "error",
                message: await getMessages(lang, "email_in_use")
            }
        )
        return
    }

    const getAccountsByUsername = await collection.find({username: req.body.username}).toArray();

    if (getAccountsByUsername.length > 0) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "username_in_use")
        })
        return
    }

    const encryptedPassword = await bcrypt.hash(password, 10)

    if (username === null || username === undefined) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "no_username_provided")
        })
        return
    }

    if (password === null || password === undefined || password === "" || password.replaceAll(" ", "") === "") {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "no_password_provided")
        })
        return
    }

    const validateEmail = (email) => {
        return email.match(
            /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        );
    };

    if (!validateEmail(email)) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_email_address")
        })
        return
    }

    const alp = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,_-"
    let token = ""

    for (let i = 0; i < 64; i++) {
        token += alp.charAt(Math.floor(Math.random() * alp.length))
    }

    const emailAlp = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

    let emailCode = ""

    for (let i = 0; i < 6; i++) {
        emailCode += emailAlp.charAt(Math.floor(Math.random() * emailAlp.length))
    }

    let id = Math.floor(Math.random() * 1000000000)

    while (await checkId(id)) {
        id = Math.floor(Math.random() * 1000000000)
    }


    let found = false

    let languages = await getLanguages()


    for(let i = 0; i < languages.length; i++) {
        console.log(i, await languages[i].short, languages)

        if (await languages[i].short === lang) {
            found = true
        }
    }

    let setLanguage

    if (found) {
        setLanguage = lang
    } else {
        setLanguage = "en-US"
    }


    const account = {
        email: {
            address: email,
            emailCode: emailCode,
            emailCodeExpire: Date.now() + 1000 * 60 * 10,
        },
        account: {
            username: username.toLowerCase(),
            lang: setLanguage,
            accountCreated: Date.now(),
            password: encryptedPassword,
            id: id,
            lastLogin: Date.now(),
        },
        flags: {
            emailConfirmed: false,
            accountActivated: false,
            terminated: false,
        },
        token: token,
    }

    await collection.insertOne(account)
    res.send({
        status: "success",
        token: token
    })

    const profileData = {
        id: id,
        flags: {
            verifiedAccount: false,
            businessAccount: false,
            betaAccess: false,
            privateAccount: false,
            advancedUser: false,
        },
        profile: {
            displayName: username,
            avatarURL: ""
        },
        social: {
            rating: 0,
            interests: [],
            likes: [],
            follower: [],
            following: [],
            badges: [],
            achievements: [],
            posts: [],
            blockedUser: []
        }
    }

    const profileCollection = db.collection('profiles')
    await profileCollection.insertOne(profileData)

    const request = mailjet.post('send', {version: 'v3.1'}).request({
        Messages: [
            {
                From: {
                    Email: 'noreply@faser.app',
                    Name: 'noreply@faser.app',
                },
                To: [
                    {
                        Email: account.email,
                        Name: profileData.displayName,
                    },
                ],
                "Subject": "Your code is: " + account.emailCode,
                "HTMLPart": '<h1>Welcome to faser</h1><p>Your verify code is <span style="font-weight: 900">' + account.emailCode + '</span>. This code will expire in 10 Minutes. </p><p style="color: #808080">If you have any questions, you can contact us at https://faser.app/support or via email at support@faser.app.</p>',
            },
        ],
    })

    request
        .then(result => {
        })
        .catch(err => {
            console.log(err.statusCode)
        })

})

app.post("/api/account/login", async (req, res) => {
    await client.connect()
    const db = client.db(dbName);
    const collection = db.collection('accounts');

    const {email, password, lang} = req.body

    const account = await collection.find({email: email}).toArray()

    await collection.updateOne({email: email}, {$set: {lastLogin: Date.now()}})

    if (account.length === 0) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "account_not_found")
        })
        return
    }

    if (!account[0].emailConfirmed) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "confirm_email")
        })
        return
    }

    if (!account[0].accountActivated) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "account_not_activated")
        })
        return
    }

    const match = await bcrypt.compare(password, account[0].password)

    if (match) {
        res.send({
            status: "success",
            token: account[0].token
        })
    } else {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_password")
        })
    }
})

app.post("/api/account/changePassword", async (req, res) => {

    await client.connect()
    const db = client.db(dbName);
    const collection = db.collection('accounts');

    const {email, password, newPassword, oldToken, lang} = req.body

    const account = await collection.find({email: email}).toArray()

    if (account.length === 0) {
        res.status(400).send({
            status: "error",
            message: "Account not found"
        })
        return
    }

    if (oldToken !== account[0].token) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_token")
        })
        return
    }

    const alp = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,_-"

    let token = ""

    for (let i = 0; i < 64; i++) {
        token += alp.charAt(Math.floor(Math.random() * alp.length))
    }

    const match = await bcrypt.compare(password, account[0].password)

    if (match) {
        const encryptedPassword = await bcrypt.hash(newPassword, 10)
        await collection.updateMany({email: email}, {
            $set: {
                password: encryptedPassword,
                token: token,
                lastLogin: Date.now()
            }
        })
        res.send({
            status: "success"
        })
    } else {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_password")
        })
    }
})

app.post("/api/account/verifyEmail", async (req, res) => {
    await client.connect()
    const db = client.db(dbName);
    const collection = db.collection('accounts');

    const {email, code, token, lang} = req.body

    const account = await collection.find({email: email}).toArray()

    if (account.length === 0) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "account_not_found")
        })
        return
    }

    if (token !== account[0].token) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_token")
        })
        return
    }

    if (account[0].emailConfirmed) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "email_alr_verified")
        })
        return
    }

    if (account[0].emailCode === code) {
        if (account[0].emailCodeExpire > Date.now()) {
            await collection.updateMany({email: email}, {
                $set: {emailConfirmed: true, accountActivated: true}

            })
            res.send({
                status: "success"
            })
        }
    } else {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_code")
        })
    }
})

app.post("/api/account/deleteAccount", async (req, res) => {
    await client.connect()
    const db = client.db(dbName);
    const collection = db.collection('accounts');
    const profiles = db.collection('profiles');

    const {email, password, token, lang} = req.body

    const account = await collection.find({email: email}).toArray()

    if (account.length === 0) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "account_not_found")
        })
        return
    }

    if (token !== account[0].token) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "invalid_token")
        })

        return
    }

    if (password === undefined) {
        res.status(400).send({
            status: "error",
            message: await getMessages(lang, "no_password_provided")
        })

        return
    }

    bcrypt.compare(password, account[0].password).then(async function (result) {
        if (result) {
            await profiles.deleteOne({id: account[0].id})

            await collection.deleteOne({email: email})
            res.send({
                status: "success"
            })
        }
    });
})

app.get("/api/account/getOwnProfile", async (req, res) => {
    const {token, lang} = req.headers

    try {
        await client.connect()
        const db = client.db(dbName);
        const collection = db.collection('accounts');
        const profiles = db.collection('profiles');



        const account = await collection.find({token: token}).toArray()

        const id = account[0].id

        const profile = await profiles.find({id: id}).toArray()

        const accountInfo = {
            accountCreated: account[0].accountCreated,
            email: account[0].email,
            lastLogin: account[0].lastLogin,
            terminated: account[0].terminated,
            username: account[0].username,
            language: account[0].lang,
        }


        res.send([profile[0], accountInfo])
    } catch (error) {
        res.status(500).send({
            status: "error",
            message: await getMessages(lang, "error")
        })
    }
})

app.post("/api/account/checkAccountState", async (req, res) => {
    const {token, lang} = req.body

    try {
        await client.connect()
        const db = client.db(dbName);
        const collection = db.collection('accounts');

        const account = await collection.find({token: token}).toArray()


        if (account.length === 0) {
            res.status(400).send({
                status: "error",
                message: await getMessages(lang, "account_not_found")
            })
        } else {
            if (account[0].accountActivated && account[0].emailConfirmed) {
                res.send({
                    status: "success",
                    message: await getMessages(lang, "account_activated")
                })
            } else {
                res.status(400).send({
                    status: "error",
                    message: await getMessages(lang, "account_not_activated")
                })
            }
        }
    } catch (error) {
        res.status(500).send({
            status: "error",
            message: await getMessages(lang, "unknown")
        })
    }
})


app.listen(3110, () => {
    console.log("Server running on port 3600")
})