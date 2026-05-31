import { createClient } from '@supabase/supabase-js';

// الرابط الكامل لمشروعك مع المفتاح المخصص للمتصفح
const supabaseUrl = 'https://ttwilanhelxkicifsflez.supabase.co';
const supabaseKey = 'sb_publishable_lwnJP6Cx_Sx8brbdPADvEQ_UBXmgEgC';

export const supabase = createClient(supabaseUrl, supabaseKey);