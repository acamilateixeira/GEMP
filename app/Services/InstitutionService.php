<?php

namespace App\Services;

use App\Models\CPFQuery;
use App\Models\Institution;
use App\Models\Modality;
use Illuminate\Support\Facades\Http;

class InstitutionService
{
    public function fetchInstitutions(string $cpf): array
    {
        $cpfQuery = CPFQuery::firstOrCreate(['cpf' => $cpf]);

        $response = Http::post('https://dev.gosat.org/api/v1/simulacao/credito', ['cpf' => $cpf]);

        if ($response->failed()) {
            throw new \Exception('Erro ao consultar a API externa');
        }

        $data = $response->json();

        foreach ($data['instituicoes'] as $inst) {
            $institution = Institution::firstOrCreate(['name' => $inst['nome']]);

            foreach ($inst['modalidades'] as $mod) {
                Modality::firstOrCreate([
                    'institution_id' => $institution->id,
                    'name' => $mod['nome'],
                    'modality_code' => $mod['cod']
                ]);
            }
        }

        return $data;
    }
}