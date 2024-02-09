import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer";
import {createWorker} from 'tesseract.js';
import { google } from "googleapis";
import path from "path";
import stream from "stream";
import 'dotenv/config'
import mjAPI from'mathjax-node';
import axios from "axios";


const upload = multer();
const app = express();
app.use(express.static("public"));
const port = process.env.PORT;


const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL + "?sslmode=require",
});

/*const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "FindEE",
  password: "Kiranmjv1027@",
  port: 5432,
});
*/   

db.connect();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const getOptionsFromDatabase = async () => {
  try {
    
    const result = await db.query('SELECT * FROM subjects');
    
    return result.rows.map(row => row.subject);
  } catch (error) {
    console.error('Error fetching options from the database:', error);
    return [];
  }
};

app.get('/options', async (req, res) => {
  const options = await getOptionsFromDatabase();
  //console.log(options)
  res.json(options);
});
 
app.get('/', async(req, res) => {
  try { 
    const result = await db.query('SELECT * FROM subjects'); 
    res.render('index.ejs', { entries: result.rows });
  } catch (error) {
    console.error('Error fetching data', error);
    res.status(500).send('Error fetching data');
  } 
});
app.get('/search', async (req, res) => {
  const query = req.query.query.toLowerCase();
  const generatedResponse_search = await generateResponse(query, "give the solution for the given question step by step:\n");

  try {
    const result = await db.query('SELECT * FROM solutions WHERE question_text ILIKE $1', [`%${query}%`]);
    const searchData = result.rows[0].solution_photo;
    //console.log(searchData);
    res.render('entry.ejs', { result, generatedResponse_search});
  } catch (err) {
    res.render('entry.ejs', {generatedResponse_search, query});
  }
});


const KEYFILEPATH = path.join("cred.json");
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});




app.post('/upload', upload.any(), async (req, res) => {
  try {
    const { body, files } = req;
    
    var data;
    for (let f = 0; f < files.length; f += 1) {
        const selectedElements = body.selectedElements || [];
        const subject_no = await db.query('SELECT * FROM subjects WHERE subject LIKE $1', [`%${selectedElements}%`]);
        data = await uploadFile( subject_no.rows[0].subject_id, files[f]);
        
    }
    const query = await generateContent('https://drive.google.com/uc?id='+data, "convert this image into text:\n");
    console.log(query);
    const generatedResponse_search = await generateContent('https://drive.google.com/uc?id='+data, "give the solution for the given question step by step:\n");
    res.render('entry.ejs', {generatedResponse_search, query});
  } catch (err) {
    res.status(500).send('Error updating the database');
  }
});



//const stream = require('stream'); // Ensure 'stream' module is imported

const uploadFile = async (bodyObject, fileObject) => {
  try {
    // Create a readable stream from the buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileObject.buffer);

    // Upload file to Google Drive
    const { data } = await google.drive({ version: "v3", auth }).files.create({
      media: {
        mimeType: fileObject.mimeType,
        body: bufferStream,
      },
      requestBody: {
        name: fileObject.originalname,
        parents: ["1P2eZAYUgIZEqD4PnPZ9vfmwgDyA_8ks0"],
      },
      fields: "id,name",
    });

    console.log(`Uploaded file ${data.name} ${data.id}`);

    // Process the uploaded file
    (async () => {
      

      // Handle image generation or any other processing
      const generatedResponse = await generateContent('https://drive.google.com/uc?id='+data.id, "convert this image into text:\n");

      console.log(generatedResponse);

      // Insert data into the database
      await db.query('INSERT INTO solutions (subject_id, question_type, question_photo,question_text) VALUES ($1, $2, $3, $4)', [bodyObject, 'NPY', data.id, generatedResponse.toLowerCase()]);
    })();
    return data.id;
  } catch (error) {
    console.error("Error uploading file:", error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
};



app.get('/entry/:subject', async (req, res) => {
  const subject = req.params.subject;
  //console.log(subject);
  const subject_code = await db.query('SELECT * FROM subjects WHERE subject = ($1)', [subject]);
  const subjectId = subject_code.rows[0].subject_id;
  const result =  await db.query('SELECT * FROM solutions WHERE subject_id = ($1)', [subjectId]);
  res.render('entry.ejs', { result });
});

app.get('/contribution', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM subjects'); 
    const items = result.rows;
    res.render('unsolved.ejs', { items });
  } catch (err) {
    res.send('Error fetching data');
  }
});


app.post('/submit', async (req, res) => {
  const selectedItemId = req.body.itemId; 
  //console.log(selectedItemId)
  const subject_code = await db.query('SELECT * FROM subjects WHERE subject = ($1)', [selectedItemId]);
  const subjectId = subject_code.rows[0].subject_id;
  //console.log(subjectId);
  try {
    const result = await db.query('SELECT * FROM solutions WHERE solution_photo IS NULL AND subject_id = $1', [subjectId]); 
    const selectedItemData = result.rows[0];
    res.render('entry.ejs', {result}); 
  } catch (err) {
    res.send('Error fetching data');
  }
});



app.post('/uploadImage', upload.any(), async (req, res) => {
  const { questionId } = req.body;
  const imageFile = req.files[0]; 
  try {
    await uploadFile1(questionId, imageFile); 
    res.render('kk.ejs');
  } catch (err) {
    res.status(500).send('Error updating the database');
  }
});

const uploadFile1 = async (bodyObject, fileObject) => {
  try {
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileObject.buffer);
    const { data } = await google.drive({ version: "v3", auth }).files.create({
      media: {
        mimeType: fileObject.mimetype, 
        body: bufferStream,
      },
      requestBody: {
        name: fileObject.originalname,
        parents: ["1xH2J1Li3tZMj2RZSkWqZ7uWTBulutFcK"],
      },
      fields: "id,name",
    });
    //console.log(`Uploaded file ${data.name} ${data.id}`);
    //console.log(bodyObject);
    
   
    await db.query('UPDATE solutions SET solution_photo = ($1) WHERE question_id = ($2)', [data.id, bodyObject]);
    
  } catch (error) {
    console.error("Error uploading file:", error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
};



app.post('/addSubject', async (req, res) => {
  const { subjectName } = req.body;

  try {
      const lastSubjectQuery = 'SELECT subject_id FROM subjects ORDER BY subject_id DESC LIMIT 1';
      const result = await db.query(lastSubjectQuery);
      let lastSubjectId = 0;
      if (result.rows.length > 0) {
          lastSubjectId = result.rows[0].subject_id;
      }
      const newSubjectId = lastSubjectId + 1;
      const queryText = 'INSERT INTO subjects (subject_id, subject) VALUES ($1, $2)';
      await db.query(queryText, [newSubjectId, subjectName]);
  } catch (error) {
      console.error('Error adding subject:', error);
      res.status(500).send('Error adding subject to the database');
  }
});




// using  gemini api 

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
//import 'dotenv/config'
const MODEL_NAME = "gemini-pro";
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
async function generateResponse(inputText) {
  
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
  };

  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
  ];

  const parts = [{ text: inputText }];

  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
    generationConfig,
    safetySettings,
  });

  const response = result.response;
  return response.text();
}
app.use(express.urlencoded({ extended: true }));

app.post('/process', async (req, res) => {
  const { inputText, questionText, index } = req.body;
  //console.log(inputText);
  const result =  await db.query('SELECT * FROM solutions WHERE subject_id = ($1)', [inputText]);
  const output =  await db.query('SELECT * FROM solutions WHERE question_id = ($1)', [questionText]);
  const inputTextFromDatabase = output.rows[0].question_photo;
  //console.log(inputTextFromDatabase);
  try {
    const generatedResponse = await generateContent('https://drive.google.com/uc?id='+inputTextFromDatabase, "give the solution in for the image step by step:\n");
    //console.log('https://drive.google.com/uc?id='+inputTextFromDatabase)
    //console.log(generatedResponse);
    res.render('entry.ejs', { result, generatedResponse, index });
    } catch (err) {
    console.error('Error generating response:', err);
    res.status(500).json({ error: 'Error generating response' });
  }
}); 
 




//image ai

//const fs = require("fs");
import { promises as fs } from "fs";
// Access your API key as an environment variable (see "Set up your API key" above)
const generationConfig = { temperature: 0.4, topP: 1, topK: 32, maxOutputTokens: 4096 };

// 2. Initialise Model for vision-based generation
const model = genAI.getGenerativeModel({ model: "gemini-pro-vision", generationConfig });

// 3. Generate Content with Image Input
async function generateContent(file, text) {
  try {
    // Read image data
    const imageData = await axios.get(file, {
      responseType: 'arraybuffer'
    });
    const imageBase64 = Buffer.from(imageData.data, 'binary').toString('base64');

  
    // Define parts
    const parts = [
      { text: text },
      {
        inlineData: {
          mimeType: "image/png",
          //mineType: "image/jpg",
          data: imageBase64
        } 
      },
    ];

    // Generate content using both text and image input
    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
    const response = await result.response;
    //console.log(response.text());
    return response.text();
  } catch (error) {
    console.error('Error generating content:', error.message);
    throw new Error('Error generating content1:', error);
  }
}


//const imagePath = "https://drive.google.com/uc?id=1fEn6VEtoYat0XDUUheqVQQEt2vWSZiee"; // Path to the uploaded image

// Generate content using the uploaded image
//generateContent();




app.listen(port, () => { 
  console.log(`Server running on http://localhost:${port}`);
});




