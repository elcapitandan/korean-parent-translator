import { config } from 'dotenv';
config();
console.log('CWD:', process.cwd());
console.log('DEEPL_API_KEY present:', !!process.env.DEEPL_API_KEY);
if (process.env.DEEPL_API_KEY) {
    console.log('Key length:', process.env.DEEPL_API_KEY.length);
}
