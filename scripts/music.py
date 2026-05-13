import os
import requests
import psycopg2
from datetime import datetime

# Configurazione
API_KEY = os.getenv('LASTFM_API_KEY')
USER = os.getenv('LASTFM_USER')
DATABASE_URL = os.getenv('DATABASE_URL')

def fetch_lastfm_data():
    # Recupera l'ultimo report settimanale (Weekly Chart)
    url = f"http://ws.audioscrobbler.com/2.0/?method=user.getweeklyartistchart&user={USER}&api_key={API_KEY}&format=json"
    response = requests.get(url).json()
    artists = response['weeklyartistchart']['artist']
    
    # Calcolo approssimativo minuti (es. 3.5 min a canzone)
    total_scrobbles = sum(int(a['playcount']) for a in artists)
    total_minutes = total_scrobbles * 3.5 
    
    return total_scrobbles, total_minutes, artists

def save_to_db(scrobbles, minutes, details):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    today = datetime.now()
    
    try:
        # Inserimento tabella Short
        cur.execute(
            "INSERT INTO music_reports (report_date, total_minutes, total_scrobbles, year, month) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (today, minutes, scrobbles, today.year, today.month)
        )
        report_id = cur.fetchone()[0]
        
        # Inserimento Top 5 Artisti (Details)
        for i, artist in enumerate(details[:5]):
            cur.execute(
                "INSERT INTO music_report_details (report_id, item_type, item_name, play_count, rank) VALUES (%s, %s, %s, %s, %s)",
                (report_id, 'artist', artist['name'], int(artist['playcount']), i+1)
            )
            
        conn.commit()
    except Exception as e:
        print(f"Errore: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    s, m, d = fetch_lastfm_data()
    save_to_db(s, m, d)