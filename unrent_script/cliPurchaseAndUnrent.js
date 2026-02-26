// const dayjs = require("./dayjs");
// const xlsx = require("xlsx");

// const mongodb = require("mongodb");

// const mongoclient = new mongodb.MongoClient(`mongodb://<username>:<password>@<host>:<port>/<database>?authSource=<authSource>`);
// const db = mongoclient.db("<database>");
// const collection = db.collection("<collection>");

// (
//     async () => {
//         try {

//             let aggregation = [
//                 {
//                     $match: {
//                         createdAt: {
//                             $gte: new Date("2024-10-11T00:00:00.000+05:30"),
//                             $lte: new Date("2024-10-12T00:00:00.000+05:30")
//                         }
//                     }
//                 },
//                 {
//                     $unwind: "$DebugLogs"
//                 },
//                 {
//                     $project: {
//                         "CallId": 1,
//                         "DebugLogs.type": 1,
//                         "DebugLogs.log": 1,
//                         "DebugLogs.source": 1,
//                         "DebugLogs.createdAt": 1,
//                         "DebugLogs.updatedAt": 1
//                     }
//                 },
//                 {
//                     $lookup: {
//                         from: "voicesessions",
//                         localField: "CallId",
//                         foreignField: "CallId",
//                         as: "voicesession"
//                     }
//                 },
//                 {
//                     $group: {
//                         _id: "$CallId",
//                         logs: {
//                             $push: "$DebugLogs"
//                         },
//                         voicesession: {
//                             $first: "$voicesession"
//                         },
//                         errorCount: {
//                             $sum: {
//                                 $cond: [{ $eq: ["$DebugLogs.type", "error"] }, 1, 0]
//                             }
//                         },
//                         totalCount: {
//                             $sum: 1
//                         }
//                     }
//                 },
//                 {
//                     $project: {
//                         _id: 1,
//                         logs: 1,
//                         errorCount: 1,
//                         totalCount: 1,
//                         callRecordingUrl: "$voicesession.CallRecordingURI",
//                         callDuration: "$voicesession.callDuration"
//                     }
//                 }
//             ];

//             const res = await collection.aggregate(aggregation, { allowDiskUse: true }).toArray();

//             const wb = xlsx.utils.book_new();

//             let data = res.map((d) => ({
//                 ...d,
//                 logs: JSON.stringify(d.logs?.map((l) => {
//                     if (l.type === "error") {
//                         l.log = l.log.split(";")?.[0];
//                     };
//                     return { ...l };
//                 }), null, 4),
//                 recordingUrl: d?.callRecordingUrl?.[0],
//                 duration: d?.callDuration?.[0]
//             }));

//             let exceededCharCount = 0;
//             let ids = [];

//             let data2 = data.filter((d) => {
//                 if (d.logs?.length > 32000) {
//                     exceededCharCount++;
//                     ids.push(d._id);
//                     return false;
//                 }
//                 else return true;
//             });

//             console.log("ids : ", ids);

//             console.log("exceededCharCount : ", exceededCharCount);

//             // console.log("data[0]", data[0]);
//             // const fs = require("fs");
//             // fs.writeFile("18_docs.json", JSON.stringify(res, null, 2), () => { });

//             const sheet = xlsx.utils.json_to_sheet(data2, "sheet1");

//             xlsx.utils.book_append_sheet(wb, sheet);

//             xlsx.writeFileXLSX(wb, "new_data.xlsx");

//             mongoclient.close();

//         } catch (error) {
//             console.error("Error: ", error);
//         }
//     }
// )();

const axios = require("axios");

require("dotenv").config();

const config = require("./cliPurchaseAndUnrentConfig.json");

const readlineSync = require("readline-sync");

console.log("Config to be executed : ", config);

const answer = readlineSync.question("Are you sure ? Type 'Yes' to proceed...");

if (answer !== "Yes") {
    process.exit(1);
}

const rentNumber = async (maxNumbersToRent = 0, doYouReallyWantToRentNumbers = false) => {
    try {

        let max = +maxNumbersToRent;
        let nums = [];
        let skip = 0, limit = 0, limitDup;

        for (let i = 0; i < Math.ceil(max / 20); ++i) {

            limit = max - skip;
            if (limit / 20 >= 1) limitDup = 20; else limitDup = limit % 20;

            let config = {
                method: 'get',
                maxBodyLength: Infinity,
                url: `https://api.plivo.com/v1/Account/${process.env.PLIVO_AUTH_ID}/PhoneNumber/?country_iso=IN&type=local&pattern=22&offset=${skip}&limit=${limitDup}`,
                headers: {
                    'Authorization': `Basic ${Buffer.from(process.env.PLIVO_AUTH_ID + ':' + process.env.PLIVO_AUTH_TOKEN).toString('base64')}`
                }
            };

            const res = await axios(config);

            if (res?.data?.objects) {

                let newNums = res?.data?.objects?.map((obj) => (obj.number));

                console.log("newNums : ", newNums);

                nums = [...nums, ...newNums];
            }

            skip = skip + 20;

        }

        console.log("final numbers : ", JSON.stringify(nums, null, 4));

        if (!doYouReallyWantToRentNumbers) return;

        if (nums.length !== max) {
            console.log("Nope numbers not available : ");
        } else {
            console.log("Yup numbers available");

            const buyNumberApis = [];

            for (let i = 0; i < nums.length; ++i) {

                let data = {
                    // "app_id": "77478732980305183"
                };

                let config = {
                    method: 'post',
                    maxBodyLength: Infinity,
                    url: `https://api.plivo.com/v1/Account/${process.env.PLIVO_AUTH_ID}/PhoneNumber/${nums[i]}/`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${Buffer.from(process.env.PLIVO_AUTH_ID + ':' + process.env.PLIVO_AUTH_TOKEN).toString('base64')}`
                    },
                    data: data
                };

                buyNumberApis.push(axios(config));

            }

            const buyNumberApisResponses = await Promise.allSettled(buyNumberApis);

            console.log("buyNumberApisResponses : ", buyNumberApisResponses);

        }

    } catch (error) {
        throw error;
    }
};

const unrentNumbers = async (numbersToBeUnrent = []) => {
    try {

        const phoneNumbers = numbersToBeUnrent;

        const unrentPhoneNumberApis = [];

        for (let i = 0; i < phoneNumbers?.length; ++i) {

            let config = {
                method: 'delete',
                maxBodyLength: Infinity,
                url: `https://api.plivo.com/v1/Account/${process.env.PLIVO_AUTH_ID}/Number/${phoneNumbers[i]}/`,
                headers: {
                    'Authorization': `Basic ${Buffer.from(process.env.PLIVO_AUTH_ID + ':' + process.env.PLIVO_AUTH_TOKEN).toString('base64')}`
                }
            };

            unrentPhoneNumberApis.push(axios(config));

        }

        const unrentPhoneNumberApisResponse = await Promise.allSettled(unrentPhoneNumberApis);

        console.log("unrentPhoneNumberApisResponse : ", unrentPhoneNumberApisResponse);

    } catch (error) {
        throw error;
    }
}

(
    async () => {
        try {

            if (config?.allowRent) {
                console.log("Calling rent number function...");
                rentNumber(config?.maxNumbersToRent, config?.doYouReallyWantToRentNumbers);
            } else {
                console.log("Calling rent number function disabled.");
            }

            if (config?.allowUnRent) {
                console.log("Calling unrent number function...");
                unrentNumbers(config?.numbersToBeUnrent);
            } else {
                console.log("Calling unrent number function disabled.");
            }

        } catch (error) {
            console.error(error);
        }
    }
)();