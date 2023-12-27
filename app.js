import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer";
import {createWorker} from 'tesseract.js';
import { google } from "googleapis";
import path from "path";
import stream from "stream";
import 'dotenv/config'

const upload = multer();
const app = express();
app.use(express.static("public"));
const port = process.env.PORT || 3000;


const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL + "?sslmode=require",
});


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

  try {

    const result = await db.query('SELECT * FROM solutions WHERE question_text ILIKE $1', [`%${query}%`]);
    const searchData = result.rows[0].solution_photo;
    //console.log(searchData);
    res.render('entry.ejs', { result });
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).send('Question was not avalible Please upload your question in home page ');
  }
});


const KEYFILEPATH = path.join("cred.json");
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});



app.post("/upload", upload.any(), async (req, res) => {
    try {
        const { body, files } = req;
        
        
        for (let f = 0; f < files.length; f += 1) {
            const selectedElements = body.selectedElements || [];
            const subject_no = await db.query('SELECT * FROM subjects WHERE subject LIKE $1', [`%${selectedElements}%`]);
            await uploadFile( subject_no.rows[0].subject_id, files[f]);
            
        }
        res.status(200).send("Form Submitted");
    } catch (f) {
        res.send(f.message);
    }
});


const uploadFile = async (bodyObject, fileObject) => {
  try {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(fileObject.buffer);
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
      (async () => {
        const worker = await createWorker('eng');
        const link = 'https://drive.google.com/uc?id='+ data.id;
        const ret = await worker.recognize(link);
        await db.query('INSERT INTO solutions (subject_id, question_type, question_photo,question_text) VALUES ($1, $2, $3, $4)', [bodyObject, 'NPY', data.id,ret.data.text.toLowerCase()]);
        console.log(ret.data.text);
        await worker.terminate();
      })();
  } catch (error) {
      console.error("Error uploading file:", error);
      throw new Error(`Failed to upload file: ${error.message}`);
  }
};

app.get('/entry/:subject', async (req, res) => {
  const subject = req.params.subject;
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




app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});




