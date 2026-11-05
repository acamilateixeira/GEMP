<?php

namespace App\Services;

use App\Models\Offer;
use App\Models\CPFQuery;
use Illuminate\Support\Facades\Http;

class OfferService
{
    public function fetchOffers(string $cpf)
    {
        // Buscar o ID do CPF na tabela cpf_queries
        $cpfQuery = CPFQuery::where('cpf', $cpf)->first();

        if (!$cpfQuery) {
            return [];
        }

        return Offer::where('cpf_query_id', $cpfQuery->id)
            ->with('modality.institution')
            ->get();
    }

    public function simulateOffer(string $cpf, int $institutionId, string $modalityCode)
    {
        // Buscar CPF no banco
        $cpfQuery = CPFQuery::where('cpf', $cpf)->first();

        if (!$cpfQuery) {
            throw new \Exception('CPF não encontrado no banco.');
        }

        // Consultar API Externa
        $response = Http::post('https://dev.gosat.org/api/v1/simulacao/oferta', [
                'cpf' => $cpf,
                'instituicao_id' => $institutionId,
                'codModalidade' => $modalityCode,
            ]);

        if ($response->failed()) {
            throw new \Exception('Erro ao consultar a API externa');
        }

        $offerData = $response->json();

        // Buscar a oferta no banco
        $offer = Offer::where('cpf_query_id', $cpfQuery->id)
            ->whereHas('modality', fn($query) => $query->where('modality_code', $modalityCode))
            ->first();

        // Atualizar oferta no banco, se encontrada
        if ($offer) {
            $offer->update([
                'interest_rate' => $offerData['jurosMes'],
                'min_installments' => $offerData['QntParcelaMin'],
                'max_installments' => $offerData['QntParcelaMax'],
                'min_amount' => $offerData['valorMin'],
                'max_amount' => $offerData['valorMax']
            ]);
        }

        return $offerData;
    }
}